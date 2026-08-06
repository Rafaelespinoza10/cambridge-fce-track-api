/// <reference path="../../types/markdown.d.ts" />
import { FlashcardType, EnglishLevel } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type { GeneratedFlashcardDraftDto } from '../../interfaces/flashcards/generate-flashcard-draft.interface';
import { renderPromptTemplate } from '../../lib/prompt-template';
import TERM_SYSTEM_PROMPT from '../../prompts/flashcards/generate-draft.system.md';
import TERM_USER_PROMPT_TEMPLATE from '../../prompts/flashcards/generate-draft.user.md';
import PRACTICE_ERROR_SYSTEM_PROMPT from '../../prompts/flashcards/generate-draft-from-practice-error.system.md';
import PRACTICE_ERROR_USER_PROMPT_TEMPLATE from '../../prompts/flashcards/generate-draft-from-practice-error.user.md';

/**
 * Shared flashcard-draft generation: JSON Schema, field-limit validation,
 * tag normalization, and LLM-error mapping used by BOTH draft sources —
 * a plain term (`generateFromTerm`, existing `POST /flashcards/ai/draft`)
 * and a Practice attempt error (`generateFromPracticeError`, new in this
 * PR). Neither the schema, the validation, nor the limits are ever
 * duplicated between the two flows — only the prompt-building differs.
 */

export const PRACTICE_ERROR_PROMPT_VERSION = 'practice-error-flashcard-v1';

// Mirrors FlashcardsService's own limits so a draft is always compatible
// with the real POST /flashcards/decks/{deckId}/cards contract.
const FRONT_MAX_LENGTH = 500;
const BACK_MAX_LENGTH = 500;
const TRANSLATION_MAX_LENGTH = 500;
const EXAMPLE_MAX_LENGTH = 2000;
const PERSONAL_EXAMPLE_MAX_LENGTH = 2000;
const NOTES_MAX_LENGTH = 5000;
const TAGS_MAX_COUNT = 20;
const TAG_MAX_LENGTH = 50;

const REQUEST_TIMEOUT_MS = 20_000;
const RESPONSE_TEMPERATURE = 0.4;
const RESPONSE_MAX_OUTPUT_TOKENS = 700;

const VALID_FLASHCARD_TYPES = new Set<string>(Object.values(FlashcardType));
const VALID_ENGLISH_LEVELS = new Set<string>(Object.values(EnglishLevel));

export enum FlashcardDraftGenerationErrorCode {
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_RATE_LIMITED = 'ai_rate_limited',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
}

/**
 * Neutral, domain-agnostic error thrown by the generator — never surfaced
 * to a client directly. Each consuming service (`GenerateFlashcardDraftService`,
 * `GeneratePracticeErrorFlashcardDraftService`) catches this and re-wraps it
 * into its own domain error class, matching this codebase's convention that
 * every domain owns its own error type.
 */
export class FlashcardDraftGenerationError extends Error {
  constructor(
    message: string,
    readonly code: FlashcardDraftGenerationErrorCode,
  ) {
    super(message);
    this.name = 'FlashcardDraftGenerationError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

/**
 * Context for `generateFromPracticeError` — already flattened into safe,
 * human-readable strings by the caller (GeneratePracticeErrorFlashcardDraftService).
 * This generator never touches PracticeAttempt/PracticeItem/PracticeAnswer
 * entities directly, and never receives userId, JWT, or any other PII.
 */
export interface PracticeErrorDraftContext {
  examCode: string;
  paperCode: string;
  partCode: string;
  taskType: string;
  prompt: string;
  /** Relevant stimulus text, when applicable — null otherwise. */
  stimulus: string | null;
  /** Already formatted as readable option lines, when applicable — null otherwise. */
  options: string | null;
  userAnswer: string;
  correctAnswer: string;
  explanation: string | null;
  skillTags: string[];
  targetLevel: EnglishLevel | null;
}

export interface FlashcardDraftGeneratorPort {
  generateFromTerm(term: string, type: FlashcardType): Promise<GeneratedFlashcardDraftDto>;
  generateFromPracticeError(
    context: PracticeErrorDraftContext,
  ): Promise<GeneratedFlashcardDraftDto>;
}

export interface FlashcardDraftGeneratorDeps {
  llm: LLMServicePort;
}

function buildTermUserPrompt(term: string, type: FlashcardType): string {
  return renderPromptTemplate(TERM_USER_PROMPT_TEMPLATE, { term, type });
}

const NOT_APPLICABLE = '(not applicable)';
const NONE_PROVIDED = '(none provided)';

function buildPracticeErrorUserPrompt(context: PracticeErrorDraftContext): string {
  return renderPromptTemplate(PRACTICE_ERROR_USER_PROMPT_TEMPLATE, {
    examCode: context.examCode,
    paperCode: context.paperCode,
    partCode: context.partCode,
    taskType: context.taskType,
    targetLevel: context.targetLevel ?? NOT_APPLICABLE,
    prompt: context.prompt,
    stimulus: context.stimulus ?? NOT_APPLICABLE,
    options: context.options ?? NOT_APPLICABLE,
    userAnswer: context.userAnswer,
    correctAnswer: context.correctAnswer,
    explanation: context.explanation ?? NONE_PROVIDED,
    skillTags: context.skillTags.length > 0 ? context.skillTags.join(', ') : NONE_PROVIDED,
  });
}

const RESPONSE_SCHEMA: LLMJsonSchema = {
  name: 'flashcard_draft',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'type',
      'front',
      'back',
      'translation',
      'example',
      'personalExample',
      'notes',
      'sourceName',
      'sourceUrl',
      'level',
      'tags',
    ],
    properties: {
      type: {
        type: 'string',
        enum: Object.values(FlashcardType),
        description: 'The flashcard category — must be exactly one of the allowed types.',
      },
      front: {
        type: 'string',
        description: 'The term, phrase, or question side of the card.',
      },
      back: {
        type: 'string',
        description: 'Clear definition/answer in English, suitable for a B1+/B2 Cambridge learner.',
      },
      translation: {
        type: ['string', 'null'],
        description: 'Spanish translation of the term/definition.',
      },
      example: {
        type: ['string', 'null'],
        description:
          'One natural example sentence in English using the term, appropriate for B1+/B2.',
      },
      personalExample: {
        type: ['string', 'null'],
        description:
          'A second example related to software, work, study, or Cambridge exam prep when natural.',
      },
      notes: {
        type: ['string', 'null'],
        description: 'Short usage notes (collocations, common contexts, register).',
      },
      sourceName: {
        type: 'null',
        description: 'Always null — no external source is provided.',
      },
      sourceUrl: {
        type: 'null',
        description: 'Always null — no external URL is provided.',
      },
      level: {
        anyOf: [{ type: 'string', enum: Object.values(EnglishLevel) }, { type: 'null' }],
        description:
          'Estimated CEFR level of the term — an estimate, not an official certification.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 5 lowercase topical tags.',
      },
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new FlashcardDraftGenerationError(
    message,
    FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE,
  );
}

function validateRequiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') invalidResponse(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') invalidResponse(`${field} must not be empty`);
  if (trimmed.length > maxLength) invalidResponse(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function validateOptionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalidResponse(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLength) invalidResponse(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function validateTags(value: unknown): string[] {
  if (!Array.isArray(value)) invalidResponse('tags must be an array');

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') invalidResponse('each tag must be a string');
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.length > TAG_MAX_LENGTH) {
      invalidResponse(`each tag must be at most ${TAG_MAX_LENGTH} characters`);
    }
    const normalized = trimmed.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      tags.push(normalized);
    }
  }
  if (tags.length > TAGS_MAX_COUNT) {
    invalidResponse(`tags must contain at most ${TAGS_MAX_COUNT} items`);
  }
  return tags;
}

/**
 * Validates a raw LLM response against the shared draft shape. When
 * `expectedType` is given (the term flow, where the client picked the
 * type), the response must match it exactly. When omitted (the practice-
 * error flow, where the model picks the type itself), any real
 * `FlashcardType` member is accepted.
 */
function validateDraftShape(
  value: unknown,
  expectedType?: FlashcardType,
): GeneratedFlashcardDraftDto {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');

  const rawType = value.type;
  if (typeof rawType !== 'string' || !VALID_FLASHCARD_TYPES.has(rawType)) {
    invalidResponse('type must be a valid flashcard type');
  }
  if (expectedType !== undefined && rawType !== expectedType) {
    invalidResponse('type does not match the requested flashcard type');
  }

  const front = validateRequiredText(value.front, 'front', FRONT_MAX_LENGTH);
  const back = validateRequiredText(value.back, 'back', BACK_MAX_LENGTH);
  const translation = validateOptionalText(
    value.translation,
    'translation',
    TRANSLATION_MAX_LENGTH,
  );
  const example = validateOptionalText(value.example, 'example', EXAMPLE_MAX_LENGTH);
  const personalExample = validateOptionalText(
    value.personalExample,
    'personalExample',
    PERSONAL_EXAMPLE_MAX_LENGTH,
  );
  const notes = validateOptionalText(value.notes, 'notes', NOTES_MAX_LENGTH);

  if (value.sourceName !== null) invalidResponse('sourceName must be null');
  if (value.sourceUrl !== null) invalidResponse('sourceUrl must be null');

  let level: EnglishLevel | null = null;
  if (value.level !== null) {
    if (typeof value.level !== 'string' || !VALID_ENGLISH_LEVELS.has(value.level)) {
      invalidResponse('level must be a valid English level or null');
    }
    level = value.level as EnglishLevel;
  }

  const tags = validateTags(value.tags);

  return {
    type: rawType as FlashcardType,
    front,
    back,
    translation,
    example,
    personalExample,
    notes,
    sourceName: null,
    sourceUrl: null,
    level,
    tags,
  };
}

function mapLLMError(error: unknown): FlashcardDraftGenerationError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new FlashcardDraftGenerationError(
          'The AI provider is not configured correctly',
          FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new FlashcardDraftGenerationError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new FlashcardDraftGenerationError(
          'The AI provider took too long to respond',
          FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new FlashcardDraftGenerationError(
          'The AI provider is currently unavailable',
          FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new FlashcardDraftGenerationError(
          'The AI provider returned an invalid response',
          FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new FlashcardDraftGenerationError(
    'The AI provider returned an unexpected error',
    FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

export class FlashcardDraftGenerator implements FlashcardDraftGeneratorPort {
  constructor(private readonly deps: FlashcardDraftGeneratorDeps) {}

  async generateFromTerm(term: string, type: FlashcardType): Promise<GeneratedFlashcardDraftDto> {
    const messages: LLMChatMessage[] = [
      { role: 'system', content: TERM_SYSTEM_PROMPT.trim() },
      { role: 'user', content: buildTermUserPrompt(term, type) },
    ];
    const raw = await this.callLLM(messages);
    return validateDraftShape(raw, type);
  }

  /**
   * No `expectedType` — the model chooses the single best-fitting type from
   * the real enum for the mistake it's looking at (see the system prompt's
   * selection criteria).
   */
  async generateFromPracticeError(
    context: PracticeErrorDraftContext,
  ): Promise<GeneratedFlashcardDraftDto> {
    const messages: LLMChatMessage[] = [
      { role: 'system', content: PRACTICE_ERROR_SYSTEM_PROMPT.trim() },
      { role: 'user', content: buildPracticeErrorUserPrompt(context) },
    ];
    const raw = await this.callLLM(messages);
    return validateDraftShape(raw);
  }

  private async callLLM(messages: LLMChatMessage[]): Promise<unknown> {
    try {
      return await this.deps.llm.completeStructured(messages, {
        responseSchema: RESPONSE_SCHEMA,
        timeoutMs: REQUEST_TIMEOUT_MS,
        temperature: RESPONSE_TEMPERATURE,
        maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
      });
    } catch (err: unknown) {
      throw mapLLMError(err);
    }
  }
}
