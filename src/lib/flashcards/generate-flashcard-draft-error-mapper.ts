import {
  GenerateFlashcardDraftError,
  GenerateFlashcardDraftErrorCode,
} from '../../services/flashcards/generate-flashcard-draft.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const GENERATE_FLASHCARD_DRAFT_STATUS_BY_CODE: Record<GenerateFlashcardDraftErrorCode, number> = {
  [GenerateFlashcardDraftErrorCode.INVALID_INPUT]: 400,
  [GenerateFlashcardDraftErrorCode.AI_RATE_LIMITED]: 429,
  [GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GenerateFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GenerateFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE]: 502,
};

function mapGenerateFlashcardDraftError(error: unknown): unknown {
  if (error instanceof GenerateFlashcardDraftError) {
    return httpError(error.message, GENERATE_FLASHCARD_DRAFT_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapGenerateFlashcardDraftError };
