import { FlashcardType, EnglishLevel } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type {
  GenerateFlashcardDraftRequest,
  GeneratedFlashcardDraftDto,
} from '../../interfaces/flashcards/generate-flashcard-draft.interface';

export enum GenerateFlashcardDraftErrorCode {
  INVALID_INPUT = 'invalid_input',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
}

export class GenerateFlashcardDraftError extends Error {
  constructor(
    message: string,
    readonly code: GenerateFlashcardDraftErrorCode,
  ) {
    super(message);
    this.name = 'GenerateFlashcardDraftError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

export interface GenerateFlashcardDraftServiceDeps {
  llm: LLMServicePort;
}

// Mirrors FlashcardsService's own limits so a draft is always compatible
// with the real POST /flashcards/decks/{deckId}/cards contract.
const TERM_MAX_LENGTH = 200;
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

const SYSTEM_PROMPT = [
  'You generate a single flashcard draft for a student preparing for the Cambridge B2 First (FCE) exam.',
  '',
  'Rules:',
  '- The main definition ("back") must be in clear, simple English appropriate for a B1+/B2 learner.',
  '- The translation must be in Spanish.',
  '- The example sentence must be natural and appropriate for a B1+/B2 learner.',
  '- personalExample should relate to software development, work, study, or Cambridge exam preparation when that connection feels natural — never forced.',
  '- Never invent a URL or a source. sourceName and sourceUrl must always be null.',
  '- All tags must be lowercase, at most 5 tags.',
  '- Do not generate offensive, unrelated, or off-topic content.',
  '- Never claim a word or phrase "officially belongs to Cambridge" or is part of an official Cambridge wordlist.',
  '- The CEFR level you return is your own estimate, not a certification.',
  '- Respond only with the JSON object described by the provided schema — no extra commentary.',
].join('\n');

function buildUserPrompt(term: string, type: FlashcardType): string {
  return `Generate a flashcard draft for the following term.\n\nTerm: "${term}"\nType: ${type}`;
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
        description: 'Must match the flashcard type requested by the user.',
      },
      front: {
        type: 'string',
        description: 'The term or phrase exactly as given by the user.',
      },
      back: {
        type: 'string',
        description: 'Clear definition in English, suitable for a B1+/B2 Cambridge learner.',
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

function normalizeTerm(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GenerateFlashcardDraftError(
      'term must be a string',
      GenerateFlashcardDraftErrorCode.INVALID_INPUT,
    );
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new GenerateFlashcardDraftError(
      'term must not be empty',
      GenerateFlashcardDraftErrorCode.INVALID_INPUT,
    );
  }
  if (trimmed.length > TERM_MAX_LENGTH) {
    throw new GenerateFlashcardDraftError(
      `term must be at most ${TERM_MAX_LENGTH} characters`,
      GenerateFlashcardDraftErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeRequestType(value: unknown): FlashcardType {
  if (typeof value !== 'string' || !VALID_FLASHCARD_TYPES.has(value)) {
    throw new GenerateFlashcardDraftError(
      'type must be a valid flashcard type',
      GenerateFlashcardDraftErrorCode.INVALID_INPUT,
    );
  }
  return value as FlashcardType;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new GenerateFlashcardDraftError(
    message,
    GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
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

function validateDraftShape(
  value: unknown,
  expectedType: FlashcardType,
): GeneratedFlashcardDraftDto {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');

  const rawType = value.type;
  if (typeof rawType !== 'string' || !VALID_FLASHCARD_TYPES.has(rawType)) {
    invalidResponse('type must be a valid flashcard type');
  }
  if (rawType !== expectedType) {
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

function mapLLMError(error: unknown): GenerateFlashcardDraftError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new GenerateFlashcardDraftError(
          'The AI provider is not configured correctly',
          GenerateFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new GenerateFlashcardDraftError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          GenerateFlashcardDraftErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new GenerateFlashcardDraftError(
          'The AI provider took too long to respond',
          GenerateFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new GenerateFlashcardDraftError(
          'The AI provider is currently unavailable',
          GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new GenerateFlashcardDraftError(
          'The AI provider returned an invalid response',
          GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new GenerateFlashcardDraftError(
    'The AI provider returned an unexpected error',
    GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/**
 * Generates an editable flashcard draft from a short term via the LLM. Pure
 * orchestration: no repository, no DataSource, nothing is persisted here —
 * the caller reviews the draft and saves it (or not) through the existing
 * flashcard CRUD.
 */
export class GenerateFlashcardDraftService {
  constructor(private readonly deps: GenerateFlashcardDraftServiceDeps) {}

  async execute(input: GenerateFlashcardDraftRequest): Promise<GeneratedFlashcardDraftDto> {
    const term = normalizeTerm(input.term);
    const type = normalizeRequestType(input.type);

    const messages: LLMChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(term, type) },
    ];

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

    return validateDraftShape(raw, type);
  }
}
