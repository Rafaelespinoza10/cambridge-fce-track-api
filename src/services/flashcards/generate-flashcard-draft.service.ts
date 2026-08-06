import { FlashcardType } from '../../models/enums';
import {
  FlashcardDraftGenerator,
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from './flashcard-draft-generator';
import type { FlashcardDraftGeneratorPort, LLMServicePort } from './flashcard-draft-generator';
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

export interface GenerateFlashcardDraftServiceDeps {
  llm: LLMServicePort;
}

const TERM_MAX_LENGTH = 200;
const VALID_FLASHCARD_TYPES = new Set<string>(Object.values(FlashcardType));

const GENERATION_ERROR_CODE_MAP: Record<
  FlashcardDraftGenerationErrorCode,
  GenerateFlashcardDraftErrorCode
> = {
  [FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR]:
    GenerateFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
  [FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED]:
    GenerateFlashcardDraftErrorCode.AI_RATE_LIMITED,
  [FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT]:
    GenerateFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
  [FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE]:
    GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
  [FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE]:
    GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
};

function mapGenerationError(error: FlashcardDraftGenerationError): GenerateFlashcardDraftError {
  return new GenerateFlashcardDraftError(error.message, GENERATION_ERROR_CODE_MAP[error.code]);
}

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

/**
 * Generates an editable flashcard draft from a short term via the LLM. Pure
 * orchestration: no repository, no DataSource, nothing is persisted here —
 * the caller reviews the draft and saves it (or not) through the existing
 * flashcard CRUD.
 *
 * All JSON Schema/validation/tag-normalization/error-mapping mechanics are
 * shared with the practice-error draft flow via `FlashcardDraftGenerator` —
 * this service only owns term-request validation and re-wraps the shared
 * generator's neutral errors into its own `GenerateFlashcardDraftError`, so
 * this class's public contract (and the existing `/flashcards/ai/draft`
 * endpoint's behavior) is unchanged by that extraction.
 */
export class GenerateFlashcardDraftService {
  private readonly generator: FlashcardDraftGeneratorPort;

  constructor(deps: GenerateFlashcardDraftServiceDeps) {
    this.generator = new FlashcardDraftGenerator({ llm: deps.llm });
  }

  async execute(input: GenerateFlashcardDraftRequest): Promise<GeneratedFlashcardDraftDto> {
    const term = normalizeTerm(input.term);
    const type = normalizeRequestType(input.type);

    try {
      return await this.generator.generateFromTerm(term, type);
    } catch (err: unknown) {
      if (err instanceof FlashcardDraftGenerationError) throw mapGenerationError(err);
      throw err;
    }
  }
}

export type { LLMServicePort };
