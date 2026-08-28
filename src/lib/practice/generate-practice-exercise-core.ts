import type { DataSource, EntityManager } from 'typeorm';
import { LLMServiceError, LLMErrorCode } from '../../services/llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../../services/llm/llm.types';
import type { PracticeExerciseSource } from '../../models/enums';
import { EnglishLevel } from '../../models/enums';
import type {
  PracticeItemOption,
  PracticeItemAnswerKey,
  PracticeItemMetadata,
  PracticeExerciseGenerationMetadata,
} from '../../models/practice-json-types';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import {
  isPracticeItemAnswerKey,
  isPracticeItemOptionArray,
  normalizeSkillTags,
} from './practice-jsonb-validators';
import MULTIPLE_CHOICE_CLOZE_INSTRUCTIONS from '../../prompts/practice/task-types/multiple-choice-cloze.md';
import OPEN_CLOZE_INSTRUCTIONS from '../../prompts/practice/task-types/open-cloze.md';
import WORD_FORMATION_INSTRUCTIONS from '../../prompts/practice/task-types/word-formation.md';
import KEY_WORD_TRANSFORMATION_INSTRUCTIONS from '../../prompts/practice/task-types/key-word-transformation.md';
import MULTIPLE_CHOICE_READING_INSTRUCTIONS from '../../prompts/practice/task-types/multiple-choice-reading.md';
import GAPPED_TEXT_INSTRUCTIONS from '../../prompts/practice/task-types/gapped-text.md';
import MULTIPLE_MATCHING_INSTRUCTIONS from '../../prompts/practice/task-types/multiple-matching.md';

/**
 * Shared core between GeneratePracticeExerciseService (catalog-driven, one
 * taskType per real exam part) and GenerateMistakePracticeExerciseService
 * (weakness-driven, same taskTypes but a caller-chosen itemCount). Neither
 * service duplicates this: schema, response validation, persistence and LLM
 * error mapping only exist once, here.
 */

export enum GeneratePracticeExerciseErrorCode {
  INVALID_INPUT = 'invalid_input',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
  /** Only ever raised by GenerateMistakePracticeExerciseService — no mistake (or no eligible one) to build a session from. */
  NO_ELIGIBLE_MISTAKES = 'no_eligible_mistakes',
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

export function invalidInput(message: string): never {
  throw new GeneratePracticeExerciseError(message, GeneratePracticeExerciseErrorCode.INVALID_INPUT);
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

/** Narrow port over SearchCambridgeKnowledgeService — grounding is optional, never required. */
export interface SearchKnowledgePort {
  execute(filters: {
    query?: string;
    skill?: string;
    topic?: string;
    limit?: number;
  }): Promise<{ content: string }[]>;
}

export type RepositorySource = DataSource | EntityManager;

export interface CreateExerciseCoreData {
  userId: string;
  idempotencyKey: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  targetLevel: EnglishLevel | null;
  title: string;
  instructions: string;
  stimulus: string | null;
  timeLimitSeconds: number | null;
  itemCount: number;
  source: PracticeExerciseSource;
  model: string | null;
  promptVersion: string | null;
  generationMetadata: PracticeExerciseGenerationMetadata | null;
}

export interface CreateItemCoreData {
  position: number;
  taskType: string;
  prompt: string;
  options: PracticeItemOption[] | null;
  answerKey: PracticeItemAnswerKey;
  explanation: string | null;
  skillTags: string[];
  metadata: PracticeItemMetadata | null;
}

/** Narrow port over PracticeExercisesRepository — only the methods this core calls. */
export interface PracticeExercisesRepositoryPort {
  createExercise(data: CreateExerciseCoreData): Promise<PracticeExercise>;
  createItems(exerciseId: string, items: CreateItemCoreData[]): Promise<PracticeItem[]>;
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
  findByIdempotencyKeyForUser(
    userId: string,
    idempotencyKey: string,
  ): Promise<PracticeExercise | null>;
}

export type GeneratedItem = Omit<CreateItemCoreData, 'metadata'>;

export const REQUEST_TIMEOUT_MS = 25_000;
export const RESPONSE_TEMPERATURE = 0.5;
export const RESPONSE_MAX_OUTPUT_TOKENS = 2500;

const TITLE_MAX_LENGTH = 255;
const INSTRUCTIONS_MAX_LENGTH = 2000;
const STIMULUS_MAX_LENGTH = 8000;
const PROMPT_MAX_LENGTH = 2000;
const EXPLANATION_MAX_LENGTH = 2000;
const ACCEPTED_ANSWER_MAX_LENGTH = 200;
const OPTION_LABEL_MAX_LENGTH = 200;
const SKILL_TAGS_MAX_COUNT = 5;

export interface GeneratablePart {
  examCode: string;
  paperCode: string;
  partCode: string;
  taskType: string;
  partLabel: string;
  taskTypeInstructions: string;
  hasOptions: boolean;
  /** Only meaningful when hasOptions is true. Defaults to 4 (every UoE/Reading-5/Reading-7 part); Reading Part 6 (gapped text) uses 7 (6 real paragraphs + 1 distractor). */
  optionCount?: number;
  requiresStimulus: boolean;
  /**
   * True only for parts where grounding the generation in real Cambridge
   * material (via SearchCambridgeKnowledgeService) meaningfully reduces
   * invented content — Reading's longer passages, not the shorter Use of
   * English cloze/transformation items. See docs/cambridge-knowledge-base.md
   * §9. Never fails generation if the Knowledge Base has no match for the
   * topic — grounding is a quality improvement, not a hard requirement.
   */
  groundingRecommended?: boolean;
}

// The only 4 B2 First parts this service knows how to generate — every
// other catalog entry (Reading 6-7, Writing, Listening, Speaking) is real
// (see practice-exam-catalog.ts) but has no prompt/schema wired up yet.
export const GENERATABLE_PARTS: Record<string, GeneratablePart> = {
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
  multiple_choice: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'READING_PART_5',
    taskType: 'multiple_choice',
    partLabel: 'Part 5 - Multiple Choice',
    taskTypeInstructions: MULTIPLE_CHOICE_READING_INSTRUCTIONS.trim(),
    hasOptions: true,
    requiresStimulus: true,
    groundingRecommended: true,
  },
  gapped_text: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'READING_PART_6',
    taskType: 'gapped_text',
    partLabel: 'Part 6 - Gapped Text',
    taskTypeInstructions: GAPPED_TEXT_INSTRUCTIONS.trim(),
    hasOptions: true,
    optionCount: 7,
    requiresStimulus: true,
    groundingRecommended: true,
  },
  multiple_matching: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'READING_PART_7',
    taskType: 'multiple_matching',
    partLabel: 'Part 7 - Multiple Matching',
    taskTypeInstructions: MULTIPLE_MATCHING_INSTRUCTIONS.trim(),
    hasOptions: true,
    requiresStimulus: true,
    groundingRecommended: true,
  },
};

/**
 * The taskTypes whose mistake is "about a word" (see @lib/mistakes/mistake-
 * concept-key.ts LEXICAL_TASK_TYPES, which this mirrors) — the only ones
 * Practice My Mistakes can meaningfully target, since every other
 * generatable part (reading comprehension/matching) is keyed by the item
 * itself, not a reusable concept.
 */
export const MISTAKE_PRACTICE_ELIGIBLE_TASK_TYPES = new Set([
  'word_formation',
  'key_word_transformation',
  'open_cloze',
  'multiple_choice_cloze',
]);

export const VALID_ENGLISH_LEVELS = new Set<string>(Object.values(EnglishLevel));

export const GROUNDING_CHUNK_MAX_LENGTH = 1200;

export function buildGroundingContext(chunks: { content: string }[]): string {
  if (chunks.length === 0) {
    return 'No additional grounding material was found for this topic — write original material as usual.';
  }
  const excerpts = chunks
    .map((chunk) => `- "${chunk.content.slice(0, GROUNDING_CHUNK_MAX_LENGTH).trim()}"`)
    .join('\n');
  return [
    'Real Cambridge B2 First Reading material for this topic area, from the',
    "Cambridge Knowledge Base. Use it only to keep the passage's vocabulary,",
    'register and topic treatment authentic — never copy it verbatim, and',
    'never present it as the passage itself:',
    excerpts,
  ].join('\n');
}

export const RESPONSE_SCHEMA: LLMJsonSchema = {
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

export function invalidResponse(message: string): never {
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

function validateOptions(
  value: unknown,
  position: number,
  expectedOptionCount: number,
): PracticeItemOption[] | null {
  if (value === null) return null;
  if (!isPracticeItemOptionArray(value)) {
    invalidResponse(`item at position ${position} has invalid options`);
  }
  if (value.length !== expectedOptionCount) {
    invalidResponse(
      `item at position ${position} must have exactly ${expectedOptionCount} options`,
    );
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
      ? validateOptions(raw.options, position, part.optionCount ?? 4)
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

export function validateGeneratedExercise(
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

const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

/**
 * Same detection pattern every idempotency handler in this codebase uses
 * (FlashcardReviewService, StartPracticeAttemptService, ...): matches on the
 * specific constraint name, not just the Postgres error code, so an
 * unrelated unique violation is never mistaken for a replay.
 */
export function isUniqueConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === constraintName;
}

export function mapLLMError(error: unknown): GeneratePracticeExerciseError {
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

/** Re-reads outside the aborted/committed transaction — never trusts anything from within it. */
export async function buildReplayResult(
  repo: PracticeExercisesRepositoryPort,
  userId: string,
  idempotencyKey: string,
): Promise<PracticeExerciseSafeWithItems> {
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

/**
 * Creates the exercise + its items and reads the safe DTO back, all on the
 * caller's manager/transaction. Shared by both generation services so
 * "how a PracticeExercise gets persisted" only exists in one place.
 */
export async function persistGeneratedExercise(
  repo: PracticeExercisesRepositoryPort,
  userId: string,
  exerciseData: CreateExerciseCoreData,
  items: CreateItemCoreData[],
): Promise<PracticeExerciseSafeWithItems> {
  const exercise = await repo.createExercise(exerciseData);
  await repo.createItems(exercise.id, items);

  const safe = await repo.findSafeExerciseWithItemsForUser(exercise.id, userId);
  if (safe === null) {
    // Unreachable within the same transaction (read-your-writes), but fail
    // loudly rather than return a bogus empty result.
    throw new GeneratePracticeExerciseError(
      'Failed to read back the exercise that was just persisted',
      GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
    );
  }
  return safe;
}
