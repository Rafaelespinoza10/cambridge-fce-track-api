import type { FlashcardType, FlashcardStatus, EnglishLevel } from '../models/enums';

export interface StartFlashcardReviewSessionInput {
  userId: string;
  /** Instante explícito de la solicitud — el servicio nunca llama a new Date(). */
  requestedAt: Date;
  deckId?: string;
}

export interface FlashcardQueueItem {
  id: string;
  deckId: string;
  type: FlashcardType;
  front: string;
  back: string;
  translation: string | null;
  example: string | null;
  personalExample: string | null;
  notes: string | null;
  level: EnglishLevel | null;
  tags: string[];
  status: FlashcardStatus;
  nextReviewAt: Date;
}

export interface StartFlashcardReviewSessionDailyProgress {
  cardsReviewed: number;
  uniqueCardsReviewed: number;
  requiredReviews: number;
  cardsDueAtFirstSession: number;
  goalCompleted: boolean;
}

export interface StartFlashcardReviewSessionQueue {
  cards: FlashcardQueueItem[];
  cardsDue: number;
}

export interface StartFlashcardReviewSessionResult {
  studySessionId: string;
  /** true si ya existía una sesión activa y se retomó; false si se creó una nueva. */
  sessionResumed: boolean;
  sessionStartedAt: Date;
  timezone: string;
  localDate: string;
  dayStartedAt: Date;
  dayEndedAt: Date;
  dailyGoal: number;
  dailyProgress: StartFlashcardReviewSessionDailyProgress;
  queue: StartFlashcardReviewSessionQueue;
}
