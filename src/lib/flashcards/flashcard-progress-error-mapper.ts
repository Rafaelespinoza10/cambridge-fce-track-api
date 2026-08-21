import {
  FlashcardProgressError,
  FlashcardProgressErrorCode,
} from '../../services/flashcards/flashcard-progress.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const FLASHCARD_PROGRESS_STATUS_BY_CODE: Record<FlashcardProgressErrorCode, number> = {
  [FlashcardProgressErrorCode.INVALID_INPUT]: 400,
  [FlashcardProgressErrorCode.USER_NOT_FOUND]: 404,
  [FlashcardProgressErrorCode.PROFILE_NOT_FOUND]: 404,
  [FlashcardProgressErrorCode.INVALID_TIMEZONE]: 400,
  [FlashcardProgressErrorCode.PREFERENCES_UPDATE_CONFLICT]: 409,
  [FlashcardProgressErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

function mapFlashcardProgressError(error: unknown): unknown {
  if (error instanceof FlashcardProgressError) {
    return httpError(error.message, FLASHCARD_PROGRESS_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapFlashcardProgressError };
