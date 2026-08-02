import { FlashcardError, FlashcardErrorCode } from '../services/flashcards.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const FLASHCARD_STATUS_BY_CODE: Record<FlashcardErrorCode, number> = {
  [FlashcardErrorCode.INVALID_INPUT]: 400,
  [FlashcardErrorCode.DECK_NOT_FOUND]: 404,
  [FlashcardErrorCode.DECK_UNAVAILABLE]: 404,
  [FlashcardErrorCode.FLASHCARD_NOT_FOUND]: 404,
  [FlashcardErrorCode.FLASHCARD_DUPLICATE]: 409,
  [FlashcardErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

function mapFlashcardError(error: unknown): unknown {
  if (error instanceof FlashcardError) {
    return httpError(error.message, FLASHCARD_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapFlashcardError };
