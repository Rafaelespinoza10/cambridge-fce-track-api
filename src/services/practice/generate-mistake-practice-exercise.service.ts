/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, PracticeExerciseSource } from '../../models/enums';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type {
  PracticeExerciseGenerationMetadata,
  MistakePracticeItemMetadata,
} from '../../models/practice-json-types';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { GenerateMistakePracticeRequest } from '../../interfaces/practice/practice-mistake-generation.interface';
import { MISTAKE_PRACTICE_QUESTION_COUNTS } from '../../interfaces/practice/practice-mistake-generation.interface';
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
import {
  pickDominantTaskType,
  selectDiverseWeaknesses,
  capExplicitSelection,
  buildSlotPlan,
  SelectMistakeWeaknessesError,
} from '@lib/mistakes/select-mistake-weaknesses';
import type {
  WeaknessCandidate,
  MistakeSlotPlan,
} from '@lib/mistakes/select-mistake-weaknesses';
import { buildMistakePracticeContext } from '@lib/practice/build-mistake-practice-context';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { pickRandomExamTopic } from '@lib/shared/exam-topics';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import type { LLMChatMessage } from '../llm/llm.types';
import SYSTEM_PROMPT from '../../prompts/practice/generate-exercise.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/practice/generate-mistake-practice.user.md';

const PROMPT_VERSION = 'mistake-practice-v1';
// Candidate pool fetched from the DB before selection/diversity is applied —
// generous on purpose (selectDiverseWeaknesses/capExplicitSelection still
// cap the final selection at MAX_SELECTION_POOL).
const WEAKNESS_POOL_QUERY_LIMIT = 30;
const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_practice_exercises_user_idempotency';

export interface MistakesRepositoryPort {
  findByIdsForUser(userId: string, ids: string[]): Promise<MistakeConcept[]>;
  findTopWeaknessesForUser(userId: string, limit: number): Promise<MistakeConcept[]>;
}

export interface GenerateMistakePracticeExerciseServiceDeps {
  llm: LLMServicePort;
  providerLabel: string;
  modelLabel: string | null;
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
  mistakes?: (source: RepositorySource) => MistakesRepositoryPort;
}

const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);
const DEFAULT_MISTAKES_FACTORY = (source: RepositorySource): MistakesRepositoryPort =>
  new MistakesRepository(source);

function toWeaknessCandidate(concept: MistakeConcept): WeaknessCandidate {
  return {
    id: concept.id,
    taskType: concept.task_type,
    baseWord: concept.base_word,
    correctAnswer: concept.correct_answer,
    errorType: concept.error_type,
    errorSubtype: concept.error_subtype,
    timesWrong: concept.times_wrong,
    lastWrongAt: concept.last_wrong_at,
  };
}

function normalizeQuestionCount(raw: number | undefined): number {
  if (raw === undefined) return 8;
  if (!MISTAKE_PRACTICE_QUESTION_COUNTS.includes(raw as (typeof MISTAKE_PRACTICE_QUESTION_COUNTS)[number])) {
    invalidInput(`questionCount must be one of: ${MISTAKE_PRACTICE_QUESTION_COUNTS.join(', ')}`);
  }
  return raw;
}

function noEligibleMistakes(message: string): never {
  throw new GeneratePracticeExerciseError(
    message,
    GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES,
  );
}

function buildMessages(
  partLabel: string,
  taskTypeInstructions: string,
  questionCount: number,
  targetLevel: EnglishLevel,
  topicHint: string,
  weaknessesContext: string,
): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    partLabel,
    itemCount: String(questionCount),
    targetLevel,
    topicHint,
    taskTypeInstructions,
    weaknessesContext,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

function toItemMetadata(plan: MistakeSlotPlan, position: number): MistakePracticeItemMetadata {
  const entry = plan.entries.find((e) => e.position === position);
  // Unreachable: validateGeneratedExercise already enforces positions are
  // exactly 1..questionCount with no gaps, and the plan has one entry per
  // position by construction — fail loudly rather than persist a mismatch.
  if (entry === undefined) {
    throw new GeneratePracticeExerciseError(
      `No slot plan entry for generated item at position ${position}`,
      GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
    );
  }
  return {
    generationSource: 'mistake_practice',
    practiceMode: entry.practiceMode,
    targetConceptId: entry.targetConceptId,
    targetErrorType: entry.targetErrorType,
    targetErrorSubtype: entry.targetErrorSubtype,
  };
}

/**
 * Generates a Practice exercise from the user's own Mistake Bank instead of
 * a catalog part: same LLM provider, same RESPONSE_SCHEMA, same exhaustive
 * validation and the same transactional persistence as
 * GeneratePracticeExerciseService (see @lib/practice/generate-practice-
 * exercise-core.ts) — this class only owns what's specific to mistake-driven
 * generation: loading/selecting weaknesses, the caller-chosen itemCount, its
 * own prompt template, and tagging every persisted item with which weakness
 * it targeted (see MistakePracticeItemMetadata).
 *
 * Never repeats an original mistake's exact item — the prompt instructs the
 * model to generate new examples of the same pattern, and which concept each
 * position targets is decided here, before the LLM call, never inferred from
 * its response.
 */
export class GenerateMistakePracticeExerciseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GenerateMistakePracticeExerciseServiceDeps,
  ) {}

  async execute(
    userId: string,
    idempotencyKey: string,
    input: GenerateMistakePracticeRequest,
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

    const plan = await this.buildPlan(userId, input, questionCount);
    const part = GENERATABLE_PARTS[plan.taskType];

    const topicHint = pickRandomExamTopic();
    const weaknessesContext = buildMistakePracticeContext(plan);
    const messages = buildMessages(
      part.partLabel,
      part.taskTypeInstructions,
      questionCount,
      EnglishLevel.B2,
      topicHint,
      weaknessesContext,
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

    const targetErrorTypes = [...new Set(plan.entries.map((e) => e.targetErrorType as string))];
    const targetErrorSubtypes = [
      ...new Set(
        plan.entries
          .map((e) => e.targetErrorSubtype)
          .filter((subtype): subtype is NonNullable<typeof subtype> => subtype !== null),
      ),
    ];
    const generationMetadata: PracticeExerciseGenerationMetadata = {
      provider: this.deps.providerLabel,
      schemaVersion: PROMPT_VERSION,
      generationSource: 'mistake_practice',
      mistakeConceptIds: plan.usedConceptIds,
      targetErrorTypes,
      targetErrorSubtypes,
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
   * Loads candidates (ownership-checked), picks the dominant taskType, then
   * applies the mode-specific selection rule — "weaknesses" mode ranks and
   * diversity-caps the user's own top mistakes, "concepts" mode trusts the
   * caller's explicit picks as-is (only a defensive pool-size truncation, no
   * diversity cap: the user already chose what to practice).
   */
  private async buildPlan(
    userId: string,
    input: GenerateMistakePracticeRequest,
    questionCount: number,
  ): Promise<MistakeSlotPlan> {
    const mistakesFactory = this.deps.mistakes ?? DEFAULT_MISTAKES_FACTORY;
    const mistakesRepo = mistakesFactory(this.dataSource);

    let candidates: WeaknessCandidate[];
    let isWeaknessesMode: boolean;

    if (input.mode === 'weaknesses') {
      isWeaknessesMode = true;
      const concepts = await mistakesRepo.findTopWeaknessesForUser(userId, WEAKNESS_POOL_QUERY_LIMIT);
      if (concepts.length === 0) {
        noEligibleMistakes('You have no recorded mistakes yet');
      }
      candidates = concepts.map(toWeaknessCandidate);
    } else {
      isWeaknessesMode = false;
      const rawIds: unknown = input.mistakeConceptIds;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        invalidInput('mistakeConceptIds must be a non-empty array');
      }
      if (!rawIds.every((id): id is string => typeof id === 'string' && id.trim() !== '')) {
        invalidInput('mistakeConceptIds must contain only non-empty strings');
      }
      const concepts = await mistakesRepo.findByIdsForUser(userId, rawIds);
      if (concepts.length === 0) {
        // Ownership is enforced inside findByIdsForUser, so this covers both
        // "these ids don't exist" and "these ids aren't yours" identically —
        // never leaking which one it was.
        noEligibleMistakes('None of the given mistakes could be found for this user');
      }
      candidates = concepts.map(toWeaknessCandidate);
    }

    let taskType: string;
    try {
      taskType = pickDominantTaskType(candidates);
    } catch (err: unknown) {
      if (err instanceof SelectMistakeWeaknessesError) {
        noEligibleMistakes(err.message);
      }
      throw err;
    }

    const filtered = candidates.filter((c) => c.taskType === taskType);
    const selected = isWeaknessesMode
      ? selectDiverseWeaknesses(filtered)
      : capExplicitSelection(filtered);

    return buildSlotPlan(selected, questionCount);
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
    plan: MistakeSlotPlan,
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
      // Not a real exam simulation — Practice My Mistakes never trades on
      // "this is your genuine B2 level", so it always targets B2 and is
      // never exam-timed.
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
      metadata: toItemMetadata(plan, item.position),
    }));

    return persistGeneratedExercise(repo, userId, exerciseData, itemsData);
  }
}
