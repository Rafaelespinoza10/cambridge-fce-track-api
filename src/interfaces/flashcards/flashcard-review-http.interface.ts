import type {
  FlashcardStatus,
  FlashcardType,
  EnglishLevel,
  StudySessionStatus,
} from '../../models/enums';

export interface StartReviewSessionRequestBody {
  deckId?: string;
}

export interface AnswerFlashcardRequestBody {
  flashcardId: string;
  rating: string;
  idempotencyKey: string;
  responseTimeMs?: number;
}

export interface FlashcardQueueItemHttp {
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
  nextReviewAt: string;
}

export interface StartReviewSessionHttpResponse {
  session: {
    id: string;
    resumed: boolean;
    startedAt: string;
    status: StudySessionStatus;
  };
  day: {
    localDate: string;
    timezone: string;
    dailyGoal: number;
    cardsDueAtFirstSession: number;
    requiredReviews: number;
    cardsReviewed: number;
    uniqueCardsReviewed: number;
    goalCompleted: boolean;
  };
  queue: {
    cardsDue: number;
    cards: FlashcardQueueItemHttp[];
  };
}

export interface AnswerFlashcardHttpResponse {
  reviewId: string;
  idempotentReplay: boolean;
  scheduling: {
    previousStatus: FlashcardStatus;
    newStatus: FlashcardStatus;
    previousNextReviewAt: string;
    newNextReviewAt: string;
    previousIntervalMinutes: number;
    newIntervalMinutes: number;
    previousEaseFactor: number;
    newEaseFactor: number;
    previousRepetitions: number;
    newRepetitions: number;
    previousLapses: number;
    newLapses: number;
  };
  dailyProgress: {
    cardsReviewed: number;
    uniqueCardsReviewed: number;
    requiredReviews: number;
    goalCompleted: boolean;
  };
  sessionProgress: {
    reviewsCount: number;
  };
}

export interface CompleteReviewSessionHttpResponse {
  session: {
    id: string;
    status: StudySessionStatus;
    startedAt: string;
    endedAt: string;
    durationMinutes: number;
  };
  summary: {
    reviewsCount: number;
  };
  idempotentReplay: boolean;
}
