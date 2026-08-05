import {
  FlashcardReviewError,
  FlashcardReviewErrorCode,
} from '../services/flashcards/flashcard-review.service';
import {
  StartFlashcardReviewSessionError,
  StartFlashcardReviewSessionErrorCode,
} from '../services/flashcards/start-flashcard-review-session.service';
import {
  CompleteFlashcardReviewSessionError,
  CompleteFlashcardReviewSessionErrorCode,
} from '../services/flashcards/complete-flashcard-review-session.service';
import { SchedulingError } from '../services/flashcards/scheduling/scheduling.types';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const FLASHCARD_REVIEW_STATUS_BY_CODE: Record<FlashcardReviewErrorCode, number> = {
  [FlashcardReviewErrorCode.INVALID_INPUT]: 400,
  [FlashcardReviewErrorCode.SESSION_NOT_FOUND]: 404,
  [FlashcardReviewErrorCode.SESSION_NOT_ACTIVE]: 409,
  // El DailyReviewStat del día se crea al iniciar sesión; que falte al responder
  // significa "no hay una sesión de hoy abierta para este día", un conflicto de
  // estado, no un 404 de recurso HTTP direccionable.
  [FlashcardReviewErrorCode.DAILY_STAT_NOT_FOUND]: 409,
  [FlashcardReviewErrorCode.FLASHCARD_NOT_FOUND]: 404,
  [FlashcardReviewErrorCode.FLASHCARD_SUSPENDED]: 409,
  [FlashcardReviewErrorCode.DECK_UNAVAILABLE]: 404,
  [FlashcardReviewErrorCode.INVALID_EASE_FACTOR]: 500,
  [FlashcardReviewErrorCode.CONCURRENT_UPDATE_CONFLICT]: 409,
};

const START_SESSION_STATUS_BY_CODE: Record<StartFlashcardReviewSessionErrorCode, number> = {
  [StartFlashcardReviewSessionErrorCode.INVALID_INPUT]: 400,
  [StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND]: 404,
  [StartFlashcardReviewSessionErrorCode.PROFILE_NOT_FOUND]: 404,
  [StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE]: 400,
  // DECK_UNAVAILABLE cubre "no existe", "de otro usuario" y "archivado" bajo un
  // único código en el servicio aprobado (no distingue el caso internamente),
  // así que se mapea uniformemente a 404 en vez de dividirlo arbitrariamente.
  [StartFlashcardReviewSessionErrorCode.DECK_UNAVAILABLE]: 404,
  [StartFlashcardReviewSessionErrorCode.SESSION_RACE_UNRESOLVED]: 409,
};

const COMPLETE_SESSION_STATUS_BY_CODE: Record<CompleteFlashcardReviewSessionErrorCode, number> = {
  [CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT]: 400,
  [CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND]: 404,
  [CompleteFlashcardReviewSessionErrorCode.INVALID_SESSION_STATUS]: 409,
  // Una sesión activa sin started_at es un dato que nunca debería faltar bajo
  // uso normal del sistema — inconsistencia de persistencia, no error del cliente.
  [CompleteFlashcardReviewSessionErrorCode.SESSION_START_TIME_MISSING]: 500,
  [CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_SESSION_START]: 409,
  [CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_LAST_REVIEW]: 409,
  [CompleteFlashcardReviewSessionErrorCode.SESSION_COMPLETION_CONFLICT]: 409,
  [CompleteFlashcardReviewSessionErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

/**
 * Traduce los errores de dominio del flujo de repaso de flashcards
 * (start/answer/complete + scheduler) a un Error con `statusCode`, consumible
 * por `handleError` de @lib/response. Un error no reconocido se devuelve tal
 * cual: handleError lo trata como 500 y enmascara su mensaje, sin filtrar SQL,
 * nombres de constraints ni stack traces.
 */
function mapFlashcardReviewError(error: unknown): unknown {
  if (error instanceof FlashcardReviewError) {
    return httpError(error.message, FLASHCARD_REVIEW_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof StartFlashcardReviewSessionError) {
    return httpError(error.message, START_SESSION_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof CompleteFlashcardReviewSessionError) {
    return httpError(error.message, COMPLETE_SESSION_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SchedulingError) {
    return httpError(error.message, 409);
  }
  return error;
}

export { mapFlashcardReviewError };
