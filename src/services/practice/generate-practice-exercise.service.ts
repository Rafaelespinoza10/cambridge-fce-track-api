/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, PracticeExerciseSource } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type {
  GeneratePracticeExerciseRequest,
  PracticeExerciseSafeWithItems,
} from '../../interfaces/practice/practice-exercise.interface';
import type {
  PracticeItemOption,
  PracticeItemAnswerKey,
  PracticeExerciseGenerationMetadata,
} from '../../models/practice-json-types';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { PracticeItem } from '../../models/PracticeItem';
import {
  isPracticeItemAnswerKey,
  isPracticeItemOptionArray,
  normalizeSkillTags,
} from '@lib/practice/practice-jsonb-validators';
import {
  isPracticeTaskType,
  isPracticeGenerationSupported,
  findPartInCatalog,
  PRACTICE_EXAM_CATALOG,
} from '@lib/practice/practice-exam-catalog';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { pickRandomExamTopic } from '@lib/shared/exam-topics';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import type {
  CreateExerciseData,
  CreateItemData,
} from '@repositories/practice/practice-exercises.repository';
import SYSTEM_PROMPT from '../../prompts/practice/generate-exercise.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/practice/generate-exercise.user.md';
import MULTIPLE_CHOICE_CLOZE_INSTRUCTIONS from '../../prompts/practice/task-types/multiple-choice-cloze.md';
import OPEN_CLOZE_INSTRUCTIONS from '../../prompts/practice/task-types/open-cloze.md';
import WORD_FORMATION_INSTRUCTIONS from '../../prompts/practice/task-types/word-formation.md';
import KEY_WORD_TRANSFORMATION_INSTRUCTIONS from '../../prompts/practice/task-types/key-word-transformation.md';

const PROMPT_VERSION = 'practice-exercise-v2';

export enum GeneratePracticeExerciseErrorCode {
  INVALID_INPUT = 'invalid_input',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
}

export class GeneratePracticeExerciseError extends Error {
  constructor(
    message: string,
    readonly code: GeneratePracticeExerciseErrorCode,
  ) {
    super(message);
    this.name = 'GeneratePracticeExerciseError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

type RepositorySource = DataSource | EntityManager;

/** Narrow port over PracticeExercisesRepository — only the methods this service calls. */
export interface PracticeExercisesRepositoryPort {
  createExercise(data: CreateExerciseData): Promise<PracticeExercise>;
  createItems(exerciseId: string, items: CreateItemData[]): Promise<PracticeItem[]>;
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
  findByIdempotencyKeyForUser(
    userId: string,
    idempotencyKey: string,
  ): Promise<PracticeExercise | null>;
}

type GeneratedItem = Omit<CreateItemData, 'metadata'>;

export interface GeneratePracticeExerciseServiceDeps {
  llm: LLMServicePort;
  /** The provider/model actually used — informational only, written to generationMetadata. */
  providerLabel: string;
  modelLabel: string | null;
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
}

const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);

const REQUEST_TIMEOUT_MS = 25_000;
const RESPONSE_TEMPERATURE = 0.5;
const RESPONSE_MAX_OUTPUT_TOKENS = 2500;

const TITLE_MAX_LENGTH = 255;
const INSTRUCTIONS_MAX_LENGTH = 2000;
const STIMULUS_MAX_LENGTH = 8000;
const PROMPT_MAX_LENGTH = 2000;
const EXPLANATION_MAX_LENGTH = 2000;
const ACCEPTED_ANSWER_MAX_LENGTH = 200;
const OPTION_LABEL_MAX_LENGTH = 200;
const SKILL_TAGS_MAX_COUNT = 5;

interface GeneratablePart {
  examCode: string;
  paperCode: string;
  partCode: string;
  taskType: string;
  partLabel: string;
  taskTypeInstructions: string;
  hasOptions: boolean;
  requiresStimulus: boolean;
}

// The only 4 B2 First parts this service knows how to generate — every
// other catalog entry (Reading 6-7, Writing, Listening, Speaking) is real
// (see practice-exam-catalog.ts) but has no prompt/schema wired up yet.
const GENERATABLE_PARTS: Record<string, GeneratablePart> = {
  multiple_choice_cloze: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    taskType: 'multiple_choice_cloze',
    partLabel: 'Part 1 - Multiple Choice Cloze',
    taskTypeInstructions: MULTIPLE_CHOICE_CLOZE_INSTRUCTIONS.trim(),
    hasOptions: true,
    requiresStimulus: true,
  },
  open_cloze: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_2',
    taskType: 'open_cloze',
    partLabel: 'Part 2 - Open Cloze',
    taskTypeInstructions: OPEN_CLOZE_INSTRUCTIONS.trim(),
    hasOptions: false,
    requiresStimulus: true,
  },
  word_formation: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    taskType: 'word_formation',
    partLabel: 'Part 3 - Word Formation',
    taskTypeInstructions: WORD_FORMATION_INSTRUCTIONS.trim(),
    hasOptions: false,
    requiresStimulus: true,
  },
  key_word_transformation: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_4',
    taskType: 'key_word_transformation',
    partLabel: 'Part 4 - Key Word Transformation',
    taskTypeInstructions: KEY_WORD_TRANSFORMATION_INSTRUCTIONS.trim(),
    hasOptions: false,
    requiresStimulus: false,
  },
};

const VALID_ENGLISH_LEVELS = new Set<string>(Object.values(EnglishLevel));

interface NormalizedRequest {
  part: GeneratablePart;
  targetLevel: EnglishLevel;
  itemCount: number;
  timeLimitSeconds: number | null;
}

function invalidInput(message: string): never {
  throw new GeneratePracticeExerciseError(message, GeneratePracticeExerciseErrorCode.INVALID_INPUT);
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

function buildMessages(normalized: NormalizedRequest): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    partLabel: normalized.part.partLabel,
    itemCount: String(normalized.itemCount),
    targetLevel: normalized.targetLevel,
    topicHint: pickRandomExamTopic(),
    taskTypeInstructions: normalized.part.taskTypeInstructions,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

const RESPONSE_SCHEMA: LLMJsonSchema = {
  name: 'practice_exercise',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'instructions', 'stimulus', 'items'],
    properties: {
      title: { type: 'string', description: 'Short title for the exercise.' },
      instructions: { type: 'string', description: 'Instructions shown to the student.' },
      stimulus: {
        type: ['string', 'null'],
        description: 'Shared passage with numbered gaps, or null for parts with no shared text.',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['position', 'prompt', 'options', 'answerKey', 'explanation', 'skillTags'],
          properties: {
            position: { type: 'integer', description: '1-based position, no gaps or repeats.' },
            prompt: { type: 'string' },
            options: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'label'],
                    properties: { id: { type: 'string' }, label: { type: 'string' } },
                  },
                },
                { type: 'null' },
              ],
            },
            answerKey: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'acceptedOptionIds'],
                  properties: {
                    kind: { type: 'string', enum: ['single_choice'] },
                    acceptedOptionIds: { type: 'array', items: { type: 'string' } },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'acceptedAnswers', 'caseSensitive'],
                  properties: {
                    kind: { type: 'string', enum: ['text'] },
                    acceptedAnswers: { type: 'array', items: { type: 'string' } },
                    caseSensitive: { type: 'boolean' },
                  },
                },
              ],
            },
            explanation: { type: 'string' },
            skillTags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new GeneratePracticeExerciseError(
    message,
    GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
  );
}

function validateText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') invalidResponse(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') invalidResponse(`${field} must not be empty`);
  if (trimmed.length > maxLength) invalidResponse(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function validateOptions(value: unknown, position: number): PracticeItemOption[] | null {
  if (value === null) return null;
  if (!isPracticeItemOptionArray(value)) {
    invalidResponse(`item at position ${position} has invalid options`);
  }
  if (value.length !== 4) {
    invalidResponse(`item at position ${position} must have exactly 4 options`);
  }
  for (const option of value) {
    if (option.label.length > OPTION_LABEL_MAX_LENGTH) {
      invalidResponse(`item at position ${position} has an option label that is too long`);
    }
  }
  return value;
}

function validateAnswerKey(
  value: unknown,
  position: number,
  options: PracticeItemOption[] | null,
): PracticeItemAnswerKey {
  if (!isPracticeItemAnswerKey(value)) {
    invalidResponse(`item at position ${position} has an invalid answerKey`);
  }

  if (value.kind === 'single_choice') {
    if (options === null) {
      invalidResponse(`item at position ${position} has a single_choice answerKey but no options`);
    }
    if (value.acceptedOptionIds.length !== 1) {
      invalidResponse(`item at position ${position} must have exactly one accepted option`);
    }
    const optionIds = new Set(options.map((option) => option.id));
    if (!value.acceptedOptionIds.every((id) => optionIds.has(id))) {
      invalidResponse(
        `item at position ${position} has an acceptedOptionIds not present in options`,
      );
    }
  } else {
    for (const answer of value.acceptedAnswers) {
      if (answer.length > ACCEPTED_ANSWER_MAX_LENGTH) {
        invalidResponse(`item at position ${position} has an accepted answer that is too long`);
      }
    }
  }

  return value;
}

function validateItems(
  value: unknown,
  part: GeneratablePart,
  expectedItemCount: number,
): GeneratedItem[] {
  if (!Array.isArray(value)) invalidResponse('items must be an array');
  if (value.length !== expectedItemCount) {
    invalidResponse(`items must contain exactly ${expectedItemCount} entries, got ${value.length}`);
  }

  const items = value.map((raw, index): GeneratedItem => {
    if (!isPlainObject(raw)) invalidResponse(`item at index ${index} must be an object`);

    const position = raw.position;
    if (typeof position !== 'number' || !Number.isInteger(position)) {
      invalidResponse(`item at index ${index} has a non-integer position`);
    }

    const prompt = validateText(
      raw.prompt,
      `item at position ${position} prompt`,
      PROMPT_MAX_LENGTH,
    );
    const options = part.hasOptions
      ? validateOptions(raw.options, position)
      : raw.options === null
        ? null
        : invalidResponse(`item at position ${position} must have null options`);
    const answerKey = validateAnswerKey(raw.answerKey, position, options);
    const explanation = validateText(
      raw.explanation,
      `item at position ${position} explanation`,
      EXPLANATION_MAX_LENGTH,
    );
    const skillTags = normalizeSkillTags(raw.skillTags).slice(0, SKILL_TAGS_MAX_COUNT);

    return {
      position,
      taskType: part.taskType,
      prompt,
      options,
      answerKey,
      explanation,
      skillTags,
    };
  });

  const positions = items.map((item) => item.position).sort((a, b) => a - b);
  const expectedPositions = Array.from({ length: expectedItemCount }, (_, i) => i + 1);
  if (JSON.stringify(positions) !== JSON.stringify(expectedPositions)) {
    invalidResponse('item positions must be exactly 1..N with no gaps or duplicates');
  }

  return items;
}

function validateGeneratedExercise(
  value: unknown,
  part: GeneratablePart,
  expectedItemCount: number,
): { title: string; instructions: string; stimulus: string | null; items: GeneratedItem[] } {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');

  const title = validateText(value.title, 'title', TITLE_MAX_LENGTH);
  const instructions = validateText(value.instructions, 'instructions', INSTRUCTIONS_MAX_LENGTH);

  let stimulus: string | null = null;
  if (part.requiresStimulus) {
    stimulus = validateText(value.stimulus, 'stimulus', STIMULUS_MAX_LENGTH);
  } else if (value.stimulus !== null) {
    invalidResponse('stimulus must be null for this task type');
  }

  const items = validateItems(value.items, part, expectedItemCount);

  return { title, instructions, stimulus, items };
}

const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_practice_exercises_user_idempotency';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

// Same detection pattern as FlashcardReviewService's idempotency handling —
// matches on the specific constraint name, not just the Postgres error code,
// so an unrelated unique violation is never mistaken for a replay.
function isIdempotencyConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === IDEMPOTENCY_CONSTRAINT_NAME;
}

function mapLLMError(error: unknown): GeneratePracticeExerciseError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new GeneratePracticeExerciseError(
          'The AI provider is not configured correctly',
          GeneratePracticeExerciseErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new GeneratePracticeExerciseError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          GeneratePracticeExerciseErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new GeneratePracticeExerciseError(
          'The AI provider took too long to respond',
          GeneratePracticeExerciseErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new GeneratePracticeExerciseError(
          'The AI provider is currently unavailable',
          GeneratePracticeExerciseErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new GeneratePracticeExerciseError(
          'The AI provider returned an invalid response',
          GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new GeneratePracticeExerciseError(
    'The AI provider returned an unexpected error',
    GeneratePracticeExerciseErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/**
 * Generates a complete Cambridge B2 First Use of English exercise (passage +
 * items) via the LLM, validates the response exhaustively, and persists the
 * exercise + its items in a single transaction — the transaction PR 1
 * prepared (createExercise/createItems accepting an EntityManager) but never
 * exercised. The LLM call always happens before any DB transaction opens —
 * never hold a transaction across network I/O.
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
      return this.buildReplayResult(this.dataSource, userId, input.idempotencyKey);
    }

    const messages = buildMessages(normalized);

    let raw: unknown;
    try {
      raw = await this.deps.llm.completeStructured(messages, {
        responseSchema: RESPONSE_SCHEMA,
        timeoutMs: REQUEST_TIMEOUT_MS,
        temperature: RESPONSE_TEMPERATURE,
        maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
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
      if (isIdempotencyConstraintViolation(err)) {
        return this.buildReplayResult(this.dataSource, userId, input.idempotencyKey);
      }
      throw err;
    }
  }

  /** Re-reads outside the aborted/committed transaction — never trusts anything from within it. */
  private async buildReplayResult(
    source: RepositorySource,
    userId: string,
    idempotencyKey: string,
  ): Promise<PracticeExerciseSafeWithItems> {
    const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const repo = factory(source);

    const existing = await repo.findByIdempotencyKeyForUser(userId, idempotencyKey);
    if (existing === null) {
      throw new GeneratePracticeExerciseError(
        'Idempotency conflict detected but no matching exercise could be found',
        GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
      );
    }

    const safe = await repo.findSafeExerciseWithItemsForUser(existing.id, userId);
    if (safe === null) {
      throw new GeneratePracticeExerciseError(
        'Idempotency conflict detected but the matching exercise could not be re-read',
        GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
      );
    }
    return safe;
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

    const exerciseData: CreateExerciseData = {
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
    const exercise = await repo.createExercise(exerciseData);

    const itemsData: CreateItemData[] = generated.items.map((item) => ({
      ...item,
      metadata: null,
    }));
    await repo.createItems(exercise.id, itemsData);

    const safe = await repo.findSafeExerciseWithItemsForUser(exercise.id, userId);
    if (safe === null) {
      // Unreachable within the same transaction (read-your-writes), but
      // fail loudly rather than return a bogus empty result.
      throw new GeneratePracticeExerciseError(
        'Failed to read back the exercise that was just persisted',
        GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
      );
    }
    return safe;
  }
}
