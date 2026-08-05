import type { FlashcardStatus, ReviewRating } from '../../models/enums';

export interface AnswerFlashcardInput {
  userId: string;
  studySessionId: string;
  flashcardId: string;
  idempotencyKey: string;
  rating: ReviewRating;
  /** Instante explícito del repaso — el servicio nunca llama a new Date(). */
  reviewedAt: Date;
  /** Fecha local ya resuelta por el caller (YYYY-MM-DD) — sin timezone aquí. */
  localDate: string;
  /** Rango UTC del día local del usuario, resuelto por el caller. */
  dayStartedAt: Date;
  dayEndedAt: Date;
  responseTimeMs?: number;
}

export interface AnswerFlashcardSchedulingResult {
  previousStatus: FlashcardStatus;
  newStatus: FlashcardStatus;
  previousNextReviewAt: Date;
  newNextReviewAt: Date;
  previousIntervalMinutes: number;
  newIntervalMinutes: number;
  previousEaseFactor: number;
  newEaseFactor: number;
  previousRepetitions: number;
  newRepetitions: number;
  previousLapses: number;
  newLapses: number;
}

export interface AnswerFlashcardDailyProgress {
  cardsReviewed: number;
  uniqueCardsReviewed: number;
  requiredReviews: number;
  goalCompleted: boolean;
}

export interface AnswerFlashcardSessionProgress {
  reviewsCount: number;
}

export interface AnswerFlashcardResult {
  reviewId: string;
  idempotentReplay: boolean;
  scheduling: AnswerFlashcardSchedulingResult;
  dailyProgress: AnswerFlashcardDailyProgress;
  sessionProgress: AnswerFlashcardSessionProgress;
}
