/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, PracticeExerciseSource } from '../../models/enums';
import type {
  GeneratePracticeExerciseRequest,
  PracticeExerciseSafeWithItems,
} from '../../interfaces/practice/practice-exercise.interface';
import type { PracticeExerciseGenerationMetadata } from '../../models/practice-json-types';
import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
  invalidInput,
  mapLLMError,
  isUniqueConstraintViolation,
  validateGeneratedExercise,
  persistGeneratedExercise,
  buildReplayResult,
  buildGroundingContext,
  GENERATABLE_PARTS,
  VALID_ENGLISH_LEVELS,
  REQUEST_TIMEOUT_MS,
  RESPONSE_TEMPERATURE,
  RESPONSE_MAX_OUTPUT_TOKENS,
  RESPONSE_SCHEMA,
} from '@lib/practice/generate-practice-exercise-core';
import type {
  LLMServicePort,
  SearchKnowledgePort,
  RepositorySource,
  GeneratablePart,
  PracticeExercisesRepositoryPort,
  CreateExerciseCoreData,
  CreateItemCoreData,
  GeneratedItem,
} from '@lib/practice/generate-practice-exercise-core';
import type { LLMChatMessage } from '../llm/llm.types';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { pickRandomExamTopic } from '@lib/shared/exam-topics';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import {
  isPracticeTaskType,
  isPracticeGenerationSupported,
  findPartInCatalog,
  PRACTICE_EXAM_CATALOG,
} from '@lib/practice/practice-exam-catalog';
import SYSTEM_PROMPT from '../../prompts/practice/generate-exercise.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/practice/generate-exercise.user.md';

const PROMPT_VERSION = 'practice-exercise-v2';

// Re-exported so existing importers (controllers, tests) keep working
// unchanged — the error type/codes are shared with the core module, not
// duplicated.
export { GeneratePracticeExerciseError, GeneratePracticeExerciseErrorCode };
export type { LLMServicePort, SearchKnowledgePort, PracticeExercisesRepositoryPort };

const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);

export interface GeneratePracticeExerciseServiceDeps {
  llm: LLMServicePort;
  /** The provider/model actually used — informational only, written to generationMetadata. */
  providerLabel: string;
  modelLabel: string | null;
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
  /** Optional — only consulted for parts with `groundingRecommended: true`. */
  searchKnowledge?: SearchKnowledgePort;
}

interface NormalizedRequest {
  part: GeneratablePart;
  targetLevel: EnglishLevel;
  itemCount: number;
  timeLimitSeconds: number | null;
}

function normalizeRequest(input: GeneratePracticeExerciseRequest): NormalizedRequest {
  if (typeof input.taskType !== 'string') invalidInput('taskType must be a string');

  const part = GENERATABLE_PARTS[input.taskType];
  if (part === undefined) {
    invalidInput(`taskType "${input.taskType}" is not supported for generation yet`);
  }
  if (
    input.examCode !== part.examCode ||
    input.paperCode !== part.paperCode ||
    input.partCode !== part.partCode
  ) {
    invalidInput('examCode/paperCode/partCode do not match the requested taskType');
  }
  // Defense in depth: the hardcoded map above must never drift from the catalog.
  if (!isPracticeTaskType(part.examCode, part.paperCode, part.partCode, part.taskType)) {
    invalidInput('taskType is not registered in the practice exam catalog');
  }
  if (!isPracticeGenerationSupported(part.examCode, part.paperCode, part.partCode)) {
    invalidInput('this part is not marked as generation-supported in the practice exam catalog');
  }

  let targetLevel = EnglishLevel.B2;
  if (input.targetLevel !== undefined) {
    if (typeof input.targetLevel !== 'string' || !VALID_ENGLISH_LEVELS.has(input.targetLevel)) {
      invalidInput('targetLevel must be a valid English level');
    }
    targetLevel = input.targetLevel;
  }

  const catalogPart = findPartInCatalog(
    PRACTICE_EXAM_CATALOG,
    part.examCode,
    part.paperCode,
    part.partCode,
  );
  const itemCount = catalogPart?.defaultItemCount;
  if (itemCount === undefined) {
    // Unreachable given GENERATABLE_PARTS is kept in sync with the catalog,
    // but fail loudly instead of generating an exercise with no item count.
    invalidInput('no default item count registered for this part');
  }
  const timeLimitSeconds =
    catalogPart?.defaultDurationMinutes !== undefined
      ? catalogPart.defaultDurationMinutes * 60
      : null;

  return { part, targetLevel, itemCount, timeLimitSeconds };
}

function buildMessages(
  normalized: NormalizedRequest,
  topicHint: string,
  groundingContext: string,
): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    partLabel: normalized.part.partLabel,
    itemCount: String(normalized.itemCount),
    targetLevel: normalized.targetLevel,
    topicHint,
    taskTypeInstructions: normalized.part.taskTypeInstructions,
    groundingContext,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_practice_exercises_user_idempotency';

/**
 * Generates a complete Cambridge B2 First Use of English exercise (passage +
 * items) via the LLM, validates the response exhaustively, and persists the
 * exercise + its items in a single transaction — the transaction PR 1
 * prepared (createExercise/createItems accepting an EntityManager) but never
 * exercised. The LLM call always happens before any DB transaction opens —
 * never hold a transaction across network I/O.
 *
 * The schema/validation/persistence/LLM-error-mapping this relies on live in
 * @lib/practice/generate-practice-exercise-core.ts, shared with
 * GenerateMistakePracticeExerciseService — this class only owns what's
 * specific to catalog-driven generation: the fixed itemCount per real exam
 * part, and this prompt template.
 */
export class GeneratePracticeExerciseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GeneratePracticeExerciseServiceDeps,
  ) {}

  async execute(
    userId: string,
    input: GeneratePracticeExerciseRequest,
  ): Promise<PracticeExerciseSafeWithItems> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      invalidInput('userId is required');
    }
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim() === '') {
      invalidInput('idempotencyKey is required');
    }

    const normalized = normalizeRequest(input);

    // Idempotency pre-check: same user + same key never reaches the LLM at
    // all, not even once — this is the primary path, the race-condition
    // catch below only covers two concurrent requests racing past this check.
    const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const existing = await factory(this.dataSource).findByIdempotencyKeyForUser(
      userId,
      input.idempotencyKey,
    );
    if (existing !== null) {
      return buildReplayResult(factory(this.dataSource), userId, input.idempotencyKey);
    }

    const topicHint = pickRandomExamTopic();

    let groundingContext = '';
    if (normalized.part.groundingRecommended === true && this.deps.searchKnowledge !== undefined) {
      // Grounding is a quality improvement, never a hard requirement — a
      // Knowledge Base miss (or an empty corpus) still lets generation
      // proceed with buildGroundingContext's "no material found" fallback,
      // exactly like the rest of this method never fails generation over
      // something optional.
      // Same fix as generate-daily-session: `query` enables the embedding
      // ranking, and `topic` is dropped because it is an exact array match
      // against import-time tags — a topic the corpus doesn't carry returned
      // nothing and silently disabled grounding.
      const chunks = await this.deps.searchKnowledge.execute({
        skill: 'reading',
        query: topicHint,
        limit: 2,
      });
      groundingContext = buildGroundingContext(chunks);
    } else if (normalized.part.groundingRecommended === true) {
      groundingContext = buildGroundingContext([]);
    }

    const messages = buildMessages(normalized, topicHint, groundingContext);

    let raw: unknown;
    try {
      raw = await this.deps.llm.completeStructured(messages, {
        responseSchema: RESPONSE_SCHEMA,
        timeoutMs: REQUEST_TIMEOUT_MS,
        temperature: RESPONSE_TEMPERATURE,
        maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
        // Reasoning-tier models (e.g. gpt-5.6) default to 'medium' effort,
        // which regularly exceeds API Gateway's ~29s hard integration
        // timeout for this endpoint. 'low' trades some reasoning depth for
        // staying inside that budget; ignored by non-reasoning models.
        reasoningEffort: 'low',
      });
    } catch (err: unknown) {
      throw mapLLMError(err);
    }

    const generated = validateGeneratedExercise(raw, normalized.part, normalized.itemCount);
    const generationMetadata: PracticeExerciseGenerationMetadata = {
      provider: this.deps.providerLabel,
      schemaVersion: PROMPT_VERSION,
    };

    try {
      return await this.dataSource.transaction((manager) =>
        this.persist(
          manager,
          userId,
          input.idempotencyKey,
          normalized,
          generated,
          generationMetadata,
        ),
      );
    } catch (err: unknown) {
      // Two concurrent requests with the same (userId, idempotencyKey) can
      // both pass the pre-check above and both reach this insert — exactly
      // one wins, the other's transaction aborts on the unique index. Only
      // THIS specific constraint counts as a replay; any other 23505 (or
      // any other error) propagates normally.
      if (isUniqueConstraintViolation(err, IDEMPOTENCY_CONSTRAINT_NAME)) {
        return buildReplayResult(factory(this.dataSource), userId, input.idempotencyKey);
      }
      throw err;
    }
  }

  private async persist(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    normalized: NormalizedRequest,
    generated: {
      title: string;
      instructions: string;
      stimulus: string | null;
      items: GeneratedItem[];
    },
    generationMetadata: PracticeExerciseGenerationMetadata,
  ): Promise<PracticeExerciseSafeWithItems> {
    const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const repo = factory(manager);

    const exerciseData: CreateExerciseCoreData = {
      userId,
      idempotencyKey,
      examCode: normalized.part.examCode,
      paperCode: normalized.part.paperCode,
      partCode: normalized.part.partCode,
      targetLevel: normalized.targetLevel,
      title: generated.title,
      instructions: generated.instructions,
      stimulus: generated.stimulus,
      timeLimitSeconds: normalized.timeLimitSeconds,
      itemCount: normalized.itemCount,
      source: PracticeExerciseSource.AI,
      model: this.deps.modelLabel,
      promptVersion: PROMPT_VERSION,
      generationMetadata,
    };

    const itemsData: CreateItemCoreData[] = generated.items.map((item) => ({
      ...item,
      metadata: null,
    }));

    return persistGeneratedExercise(repo, userId, exerciseData, itemsData);
  }
}
