/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, PracticeExerciseSource } from '../../models/enums';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type {
  PracticeExerciseGenerationMetadata,
  MistakeRemixItemMetadata,
} from '../../models/practice-json-types';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { GenerateMistakeRemixRequest } from '../../interfaces/practice/practice-mistake-remix.interface';
import { MISTAKE_REMIX_QUESTION_COUNTS } from '../../interfaces/practice/practice-mistake-remix.interface';
import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
  invalidInput,
  mapLLMError,
  isUniqueConstraintViolation,
  validateGeneratedExercise,
  persistGeneratedExercise,
  buildReplayResult,
  GENERATABLE_PARTS,
  REQUEST_TIMEOUT_MS,
  RESPONSE_TEMPERATURE,
  RESPONSE_MAX_OUTPUT_TOKENS,
  RESPONSE_SCHEMA,
} from '@lib/practice/generate-practice-exercise-core';
import type {
  LLMServicePort,
  RepositorySource,
  PracticeExercisesRepositoryPort,
  CreateExerciseCoreData,
  CreateItemCoreData,
} from '@lib/practice/generate-practice-exercise-core';
import { buildRemixPlan } from '@lib/mistakes/select-mistake-remix';
import type { RemixConceptCandidate, RemixPlan, RemixWeaknessPattern } from '@lib/mistakes/select-mistake-remix';
import { buildMistakeRemixContext } from '@lib/practice/build-mistake-remix-context';
import { extractBaseWord } from '@lib/mistakes/mistake-concept-key';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { pickRandomExamTopic } from '@lib/shared/exam-topics';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { MistakeMasteryRepository } from '@repositories/mistakes/mistake-mastery.repository';
import { computeWeaknessProfiles } from '../mistakes/compute-weakness-profiles';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';
import { getUserTimeZone } from '../planning/resolve-user-local-day';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import type { LLMChatMessage } from '../llm/llm.types';
import SYSTEM_PROMPT from '../../prompts/practice/generate-exercise.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/practice/generate-mistake-remix.user.md';

const PROMPT_VERSION = 'mistake-remix-v1';
// v1 scope is Word Formation only — see docs/mistake-bank.md §10. Extending
// to another part later only means widening this and the profile filter
// below; nothing else in this service assumes word_formation specifically.
const REMIX_PART_KEY = 'word_formation';
// Concept pool fetched before pattern matching — generous so that a pattern
// computeWeaknessProfiles reports (from the FULL mistake_concepts table)
// almost never fails to find a concrete concept to build a prompt example
// from (see buildRemixPlan's own "exclude a pattern with no concept" rule).
const CONCEPT_POOL_QUERY_LIMIT = 50;
const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_practice_exercises_user_idempotency';

export interface MistakesRepositoryPort {
  findTopWeaknessesForUser(userId: string, limit: number): Promise<MistakeConcept[]>;
}

export interface GenerateMistakeRemixExerciseServiceDeps {
  llm: LLMServicePort;
  providerLabel: string;
  modelLabel: string | null;
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
  mistakes?: (source: RepositorySource) => MistakesRepositoryPort;
  /**
   * The user's scored weakness patterns — the SAME aggregation
   * GET /practice/weaknesses returns (weakest-first). Injectable seam for
   * tests; the default calls computeWeaknessProfiles directly so a Remix
   * session always ranks on the evidence as it stands right now.
   */
  weaknessProfiles?: (userId: string) => Promise<WeaknessDto[]>;
}

const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);
const DEFAULT_MISTAKES_FACTORY = (source: RepositorySource): MistakesRepositoryPort =>
  new MistakesRepository(source);

function normalizeQuestionCount(raw: number | undefined): number {
  if (raw === undefined) return 8;
  if (!MISTAKE_REMIX_QUESTION_COUNTS.includes(raw as (typeof MISTAKE_REMIX_QUESTION_COUNTS)[number])) {
    invalidInput(`questionCount must be one of: ${MISTAKE_REMIX_QUESTION_COUNTS.join(', ')}`);
  }
  return raw;
}

function noEligibleMistakes(message: string): never {
  throw new GeneratePracticeExerciseError(
    message,
    GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES,
  );
}

function toRemixPattern(profile: WeaknessDto): RemixWeaknessPattern {
  return {
    partCode: profile.partCode,
    errorType: profile.errorType,
    errorSubtype: profile.errorSubtype,
    masteryScore: profile.masteryScore,
    lastWrongAt: profile.lastWrongAt,
  };
}

function toRemixConcept(concept: MistakeConcept): RemixConceptCandidate {
  return {
    partCode: concept.part_code,
    errorType: concept.error_type,
    errorSubtype: concept.error_subtype,
    baseWord: concept.base_word,
    correctAnswer: concept.correct_answer,
    timesWrong: concept.times_wrong,
  };
}

function buildMessages(
  partLabel: string,
  taskTypeInstructions: string,
  questionCount: number,
  targetLevel: EnglishLevel,
  topicHint: string,
  remixContext: string,
): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    partLabel,
    itemCount: String(questionCount),
    targetLevel,
    topicHint,
    taskTypeInstructions,
    remixContext,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

function toItemMetadata(
  plan: RemixPlan,
  item: { position: number; prompt: string },
): MistakeRemixItemMetadata {
  const entry = plan.entries.find((e) => e.position === item.position);
  // Unreachable: validateGeneratedExercise already enforces positions are
  // exactly 1..questionCount with no gaps, and the plan has one entry per
  // position by construction — fail loudly rather than persist a mismatch.
  if (entry === undefined) {
    throw new GeneratePracticeExerciseError(
      `No slot plan entry for generated item at position ${item.position}`,
      GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
    );
  }
  return {
    generationSource: 'mistake_remix',
    questionRole: entry.role,
    targetErrorType: entry.targetErrorType,
    targetErrorSubtype: entry.targetErrorSubtype,
    // Read off the model's own generated prompt, same parser the Mistake
    // Bank and Practice My Mistakes use — never asked of the model.
    itemBaseWord: extractBaseWord(REMIX_PART_KEY, item.prompt),
  };
}

/** Minimal structured observability — never logs full prompts/LLM responses. */
function logRemixGenerated(input: {
  userId: string;
  exerciseId: string;
  questionCount: number;
  targetedCount: number;
  neutralCount: number;
  patterns: RemixPlan['targetPatterns'];
}): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: 'mistake_remix_generated',
      userId: input.userId,
      exerciseId: input.exerciseId,
      questionCount: input.questionCount,
      targetedCount: input.targetedCount,
      neutralCount: input.neutralCount,
      patterns: input.patterns,
    }),
  );
}

/**
 * Generates a mixed, adaptive mini-test from the user's own weakness
 * patterns instead of a catalog part or a single dominant pattern: some
 * items target a real weakness (a NEW word family, never the original), the
 * rest are plain, untargeted Part 3 control items — interleaved so the
 * session doesn't telegraph which is which. Shares its schema, response
 * validation, LLM-error-mapping and transactional persistence with every
 * other generator (see @lib/practice/generate-practice-exercise-core.ts);
 * this class only owns weakness-pattern selection/allocation/interleaving
 * (@lib/mistakes/select-mistake-remix.ts), its own prompt template, and
 * tagging every persisted item with its role (see MistakeRemixItemMetadata).
 *
 * v1 scope: UoE Part 3 (Word Formation) only — the only part with error
 * subtypes, base words and mastery scoring today.
 */
export class GenerateMistakeRemixExerciseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GenerateMistakeRemixExerciseServiceDeps,
  ) {}

  async execute(
    userId: string,
    idempotencyKey: string,
    input: GenerateMistakeRemixRequest,
  ): Promise<PracticeExerciseSafeWithItems> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      invalidInput('idempotencyKey is required');
    }

    const questionCount = normalizeQuestionCount(input.questionCount);
    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;

    const existing = await exercisesFactory(this.dataSource).findByIdempotencyKeyForUser(
      userId,
      idempotencyKey,
    );
    if (existing !== null) {
      return buildReplayResult(exercisesFactory(this.dataSource), userId, idempotencyKey);
    }

    const plan = await this.buildPlan(userId, questionCount);
    const part = GENERATABLE_PARTS[REMIX_PART_KEY];

    const topicHint = pickRandomExamTopic();
    const remixContext = buildMistakeRemixContext(plan);
    const messages = buildMessages(
      part.partLabel,
      part.taskTypeInstructions,
      questionCount,
      EnglishLevel.B2,
      topicHint,
      remixContext,
    );

    let raw: unknown;
    try {
      raw = await this.deps.llm.completeStructured(messages, {
        responseSchema: RESPONSE_SCHEMA,
        timeoutMs: REQUEST_TIMEOUT_MS,
        temperature: RESPONSE_TEMPERATURE,
        maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
        reasoningEffort: 'low',
      });
    } catch (err: unknown) {
      throw mapLLMError(err);
    }

    const generated = validateGeneratedExercise(raw, part, questionCount);

    const generationMetadata: PracticeExerciseGenerationMetadata = {
      provider: this.deps.providerLabel,
      schemaVersion: PROMPT_VERSION,
      generationSource: 'mistake_remix',
      remixTargetPatterns: plan.targetPatterns,
      remixNeutralCount: plan.neutralCount,
    };

    try {
      return await this.dataSource.transaction((manager) =>
        this.persist(manager, userId, idempotencyKey, part, questionCount, generated, plan, generationMetadata),
      );
    } catch (err: unknown) {
      if (isUniqueConstraintViolation(err, IDEMPOTENCY_CONSTRAINT_NAME)) {
        return buildReplayResult(exercisesFactory(this.dataSource), userId, idempotencyKey);
      }
      throw err;
    }
  }

  /**
   * The same aggregation GET /practice/weaknesses runs. Deliberately not
   * cached or persisted — a session always ranks on the evidence as it
   * stands right now, exactly like Practice My Mistakes' own weaknesses mode.
   */
  private async resolveWeaknessProfiles(userId: string): Promise<WeaknessDto[]> {
    if (this.deps.weaknessProfiles !== undefined) return this.deps.weaknessProfiles(userId);

    return computeWeaknessProfiles(
      {
        repository: new MistakeMasteryRepository(this.dataSource),
        resolveTimeZone: (id) => getUserTimeZone(this.dataSource, id),
      },
      userId,
    );
  }

  private async buildPlan(userId: string, questionCount: number): Promise<RemixPlan> {
    const profiles = await this.resolveWeaknessProfiles(userId);
    if (profiles.length === 0) {
      noEligibleMistakes('You have no recorded weaknesses yet');
    }

    const part = GENERATABLE_PARTS[REMIX_PART_KEY];
    const eligibleProfiles = profiles.filter((p) => p.partCode === part.partCode);
    if (eligibleProfiles.length === 0) {
      noEligibleMistakes('None of your weaknesses are in a part Mistake Remix supports yet');
    }

    const mistakesFactory = this.deps.mistakes ?? DEFAULT_MISTAKES_FACTORY;
    const concepts = await mistakesFactory(this.dataSource).findTopWeaknessesForUser(
      userId,
      CONCEPT_POOL_QUERY_LIMIT,
    );

    return buildRemixPlan(
      eligibleProfiles.map(toRemixPattern),
      concepts.map(toRemixConcept),
      questionCount,
    );
  }

  private async persist(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    part: (typeof GENERATABLE_PARTS)[string],
    questionCount: number,
    generated: {
      title: string;
      instructions: string;
      stimulus: string | null;
      items: Array<{
        position: number;
        taskType: string;
        prompt: string;
        options: CreateItemCoreData['options'];
        answerKey: CreateItemCoreData['answerKey'];
        explanation: string;
        skillTags: string[];
      }>;
    },
    plan: RemixPlan,
    generationMetadata: PracticeExerciseGenerationMetadata,
  ): Promise<PracticeExerciseSafeWithItems> {
    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const repo = exercisesFactory(manager);

    const exerciseData: CreateExerciseCoreData = {
      userId,
      idempotencyKey,
      examCode: part.examCode,
      paperCode: part.paperCode,
      partCode: part.partCode,
      // Not a real exam simulation, same reasoning as Practice My Mistakes.
      targetLevel: EnglishLevel.B2,
      title: generated.title,
      instructions: generated.instructions,
      stimulus: generated.stimulus,
      timeLimitSeconds: null,
      itemCount: questionCount,
      source: PracticeExerciseSource.AI,
      model: this.deps.modelLabel,
      promptVersion: PROMPT_VERSION,
      generationMetadata,
    };

    const itemsData: CreateItemCoreData[] = generated.items.map((item) => ({
      ...item,
      metadata: toItemMetadata(plan, item),
    }));

    const safe = await persistGeneratedExercise(repo, userId, exerciseData, itemsData);
    logRemixGenerated({
      userId,
      exerciseId: safe.exercise.id,
      questionCount,
      targetedCount: plan.targetedCount,
      neutralCount: plan.neutralCount,
      patterns: plan.targetPatterns,
    });
    return safe;
  }
}
