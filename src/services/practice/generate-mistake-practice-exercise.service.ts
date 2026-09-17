/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, PracticeExerciseSource } from '../../models/enums';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type { WeaknessReview } from '../../models/WeaknessReview';
import type { MistakeErrorType, MistakeErrorSubtype } from '../../models/enums';
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
import type { WeaknessCandidate, MistakeSlotPlan } from '@lib/mistakes/select-mistake-weaknesses';
import { extractBaseWord } from '@lib/mistakes/mistake-concept-key';
import { buildPatternKey } from '@lib/mistakes/mistake-pattern';
import { buildMistakePracticeContext } from '@lib/practice/build-mistake-practice-context';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { pickRandomExamTopic } from '@lib/shared/exam-topics';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { WeaknessReviewsRepository } from '@repositories/mistakes/weakness-reviews.repository';
import { RETEST_CONSTANTS, retestItemCount } from '@lib/mistakes/retest-scheduler';
import { MASTERY_CONSTANTS } from '@lib/mistakes/mastery-score';
import { MistakeMasteryRepository } from '@repositories/mistakes/mistake-mastery.repository';
import {
  computeWeaknessProfiles,
  toMasteryScoreByPattern,
} from '../mistakes/compute-weakness-profiles';
import { getUserTimeZone } from '../planning/resolve-user-local-day';
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
  findByPatternsForUser(
    userId: string,
    patterns: Array<{
      partCode: string;
      errorType: MistakeErrorType;
      errorSubtype: MistakeErrorSubtype | null;
    }>,
  ): Promise<MistakeConcept[]>;
}

/** The reviews a retest reads — always ownership-checked, never by id alone. */
export interface WeaknessReviewsReadPort {
  findScheduledForUser(userId: string): Promise<WeaknessReview[]>;
  findScheduledByIdsForUser(userId: string, ids: string[]): Promise<WeaknessReview[]>;
}

export interface GenerateMistakePracticeExerciseServiceDeps {
  llm: LLMServicePort;
  providerLabel: string;
  modelLabel: string | null;
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
  mistakes?: (source: RepositorySource) => MistakesRepositoryPort;
  /**
   * Pattern key -> mastery score, used to practise the least-mastered
   * weaknesses first. Injectable seam for tests; the default derives it from
   * the same evidence GET /practice/weaknesses shows, so what the user sees
   * ranked worst is what a session actually targets.
   */
  weaknessScores?: (userId: string) => Promise<Map<string, number>>;
  /** Injectable seams for spaced retesting (`mode: 'retest'`). */
  reviews?: (source: RepositorySource) => WeaknessReviewsReadPort;
  now?: () => Date;
  /** Injectable seam for tests — the default reads the real practice history. */
  wordsToAvoid?: (userId: string, plan: MistakeSlotPlan, partCode: string) => Promise<string[]>;
}

const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);
const DEFAULT_MISTAKES_FACTORY = (source: RepositorySource): MistakesRepositoryPort =>
  new MistakesRepository(source);
const DEFAULT_REVIEWS_FACTORY = (source: RepositorySource): WeaknessReviewsReadPort =>
  new WeaknessReviewsRepository(source);

function toWeaknessCandidate(concept: MistakeConcept): WeaknessCandidate {
  return {
    id: concept.id,
    partCode: concept.part_code,
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
  if (
    !MISTAKE_PRACTICE_QUESTION_COUNTS.includes(
      raw as (typeof MISTAKE_PRACTICE_QUESTION_COUNTS)[number],
    )
  ) {
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

function toItemMetadata(
  plan: MistakeSlotPlan,
  item: { position: number; prompt: string },
): MistakePracticeItemMetadata {
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
    // A retest's items are the evidence that closes a review, so they must
    // carry the same source the exercise does.
    generationSource: entry.scheduledReviewId === undefined ? 'mistake_practice' : 'spaced_retest',
    practiceMode: entry.practiceMode,
    targetConceptId: entry.targetConceptId,
    targetErrorType: entry.targetErrorType,
    targetErrorSubtype: entry.targetErrorSubtype,
    // Read off the model's own generated prompt, with the same parser the
    // Mistake Bank uses on the failing item — never asked of the model, and
    // never assumed to be the targeted concept's word (a pattern-transfer
    // item is supposed to use a different one).
    itemBaseWord: extractBaseWord(plan.taskType, item.prompt),
    ...(entry.scheduledReviewId === undefined
      ? {}
      : { scheduledReviewId: entry.scheduledReviewId }),
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

    // A retest's size is decided by how many patterns it covers, not by the
    // caller — see retestItemCount.
    const questionCount = input.mode === 'retest' ? 0 : normalizeQuestionCount(input.questionCount);
    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;

    const existing = await exercisesFactory(this.dataSource).findByIdempotencyKeyForUser(
      userId,
      idempotencyKey,
    );
    if (existing !== null) {
      return buildReplayResult(exercisesFactory(this.dataSource), userId, idempotencyKey);
    }

    const plan = await this.buildPlan(userId, input, questionCount);
    // The retest planner owns its own item count; every other mode already
    // agreed on one before the plan was built.
    const itemCount = plan.entries.length;
    const part = GENERATABLE_PARTS[plan.taskType];

    const topicHint = pickRandomExamTopic();
    const weaknessesContext = buildMistakePracticeContext(
      plan,
      input.mode === 'retest' ? await this.resolveWordsToAvoid(userId, plan, part.partCode) : [],
    );
    const messages = buildMessages(
      part.partLabel,
      part.taskTypeInstructions,
      itemCount,
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

    const generated = validateGeneratedExercise(raw, part, itemCount);

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
      generationSource: input.mode === 'retest' ? 'spaced_retest' : 'mistake_practice',
      mistakeConceptIds: plan.usedConceptIds,
      targetErrorTypes,
      targetErrorSubtypes,
    };

    try {
      return await this.dataSource.transaction((manager) =>
        this.persist(
          manager,
          userId,
          idempotencyKey,
          part,
          itemCount,
          generated,
          plan,
          generationMetadata,
        ),
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
  /**
   * The same aggregation GET /practice/weaknesses runs, reduced to what the
   * selection needs. Two extra aggregate reads before an LLM call that takes
   * seconds — deliberately not cached or persisted, so a session always
   * ranks on the evidence as it stands right now.
   */
  private async resolveWeaknessScores(userId: string): Promise<Map<string, number>> {
    if (this.deps.weaknessScores !== undefined) return this.deps.weaknessScores(userId);

    const profiles = await computeWeaknessProfiles(
      {
        repository: new MistakeMasteryRepository(this.dataSource),
        resolveTimeZone: (id) => getUserTimeZone(this.dataSource, id),
      },
      userId,
    );
    return toMasteryScoreByPattern(profiles);
  }

  /**
   * Turns the user's due reviews into a slot plan. Unlike the other two
   * modes this one is driven by weakness *patterns* (a review schedules a
   * pattern, not a word), so it loads every concept under those patterns and
   * lets the planner rotate through them — with every slot forced to
   * `pattern_transfer` and stamped with the review it answers.
   */
  private async buildRetestPlan(
    userId: string,
    input: GenerateMistakePracticeRequest,
    mistakesRepo: MistakesRepositoryPort,
  ): Promise<MistakeSlotPlan> {
    const reviewsRepo = (this.deps.reviews ?? DEFAULT_REVIEWS_FACTORY)(this.dataSource);
    const now = (this.deps.now ?? (() => new Date()))();

    const rawIds: unknown = input.reviewIds;
    const explicitIds =
      rawIds === undefined
        ? null
        : Array.isArray(rawIds) && rawIds.every((id) => typeof id === 'string' && id.trim() !== '')
          ? (rawIds as string[])
          : invalidInput('reviewIds must be an array of non-empty strings');

    // Ownership is enforced inside both lookups, so "not yours" and "does
    // not exist" are indistinguishable from here.
    const scheduled =
      explicitIds === null
        ? (await reviewsRepo.findScheduledForUser(userId)).filter(
            (review) => review.due_at.getTime() <= now.getTime(),
          )
        : await reviewsRepo.findScheduledByIdsForUser(userId, explicitIds);

    if (scheduled.length === 0) {
      noEligibleMistakes('You have no reviews due right now');
    }

    // Most urgent first (oldest due date), then capped: a review is a
    // check-up, never a full practice set.
    const patterns = [...scheduled]
      .sort((a, b) => a.due_at.getTime() - b.due_at.getTime())
      .slice(0, RETEST_CONSTANTS.MAX_PATTERNS_PER_SESSION);

    const concepts = await mistakesRepo.findByPatternsForUser(
      userId,
      patterns.map((review) => ({
        partCode: review.part_code,
        errorType: review.error_type,
        errorSubtype: review.error_subtype,
      })),
    );
    if (concepts.length === 0) {
      // The pattern's mistakes were removed after it was scheduled — there
      // is nothing left to build a retest from.
      noEligibleMistakes('The scheduled reviews no longer have any mistakes behind them');
    }

    const candidates = concepts.map(toWeaknessCandidate);
    const taskType = this.pickTaskType(candidates);
    const filtered = candidates.filter((c) => c.taskType === taskType);

    const reviewIdByPatternKey = new Map(
      patterns.map((review) => [
        buildPatternKey({
          partCode: review.part_code,
          errorType: review.error_type,
          errorSubtype: review.error_subtype,
        }),
        review.id,
      ]),
    );
    // Only the patterns that survived the single-taskType collapse are
    // actually being retested; the rest stay due for another session.
    const coveredKeys = new Set(
      filtered.map((c) =>
        buildPatternKey({
          partCode: c.partCode,
          errorType: c.errorType,
          errorSubtype: c.errorSubtype,
        }),
      ),
    );
    const coveredPatterns = [...reviewIdByPatternKey.keys()].filter((key) => coveredKeys.has(key));

    return buildSlotPlan(filtered, retestItemCount(coveredPatterns.length), {
      reviewIdByPatternKey,
    });
  }

  /**
   * The families already drilled for the patterns this retest covers, within
   * one answer half-life. Best-effort: if the lookup finds nothing the
   * prompt simply carries no avoid-list, and the generator's standing
   * "use a NEW word family" instruction still applies.
   */
  private async resolveWordsToAvoid(
    userId: string,
    plan: MistakeSlotPlan,
    partCode: string,
  ): Promise<string[]> {
    if (this.deps.wordsToAvoid !== undefined) {
      return this.deps.wordsToAvoid(userId, plan, partCode);
    }
    const since = new Date(
      (this.deps.now ?? (() => new Date()))().getTime() -
        MASTERY_CONSTANTS.ANSWER_HALF_LIFE_DAYS * 86_400_000,
    );
    const rows = await new MistakeMasteryRepository(this.dataSource).findRecentFamilies(
      userId,
      since,
    );
    const wanted = new Set(
      plan.entries.map((entry) =>
        buildPatternKey({
          partCode,
          errorType: entry.targetErrorType,
          errorSubtype: entry.targetErrorSubtype,
        }),
      ),
    );
    const families = new Set<string>();
    for (const row of rows) {
      const key = buildPatternKey({
        partCode: row.partCode,
        errorType: row.errorType,
        errorSubtype: row.errorSubtype,
      });
      if (!wanted.has(key)) continue;
      for (const family of row.families) families.add(family);
    }
    return [...families];
  }

  /** Shared by every mode: one exercise is always one taskType. */
  private pickTaskType(candidates: WeaknessCandidate[]): string {
    try {
      return pickDominantTaskType(candidates);
    } catch (err: unknown) {
      if (err instanceof SelectMistakeWeaknessesError) {
        noEligibleMistakes(err.message);
      }
      throw err;
    }
  }

  private async buildPlan(
    userId: string,
    input: GenerateMistakePracticeRequest,
    questionCount: number,
  ): Promise<MistakeSlotPlan> {
    const mistakesFactory = this.deps.mistakes ?? DEFAULT_MISTAKES_FACTORY;
    const mistakesRepo = mistakesFactory(this.dataSource);

    if (input.mode === 'retest') {
      return this.buildRetestPlan(userId, input, mistakesRepo);
    }

    let candidates: WeaknessCandidate[];
    let isWeaknessesMode: boolean;

    if (input.mode === 'weaknesses') {
      isWeaknessesMode = true;
      const concepts = await mistakesRepo.findTopWeaknessesForUser(
        userId,
        WEAKNESS_POOL_QUERY_LIMIT,
      );
      if (concepts.length === 0) {
        noEligibleMistakes('You have no recorded mistakes yet');
      }
      // Only this mode ranks by mastery: "practice this mistake" targets
      // what the user explicitly picked, whatever its score.
      const masteryByPattern = await this.resolveWeaknessScores(userId);
      candidates = concepts.map((concept) => ({
        ...toWeaknessCandidate(concept),
        masteryScore: masteryByPattern.get(
          buildPatternKey({
            partCode: concept.part_code,
            errorType: concept.error_type,
            errorSubtype: concept.error_subtype,
          }),
        ),
      }));
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
      metadata: toItemMetadata(plan, item),
    }));

    return persistGeneratedExercise(repo, userId, exerciseData, itemsData);
  }
}
