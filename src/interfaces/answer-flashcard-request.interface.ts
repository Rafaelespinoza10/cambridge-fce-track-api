import type { ReviewRating } from '../models/enums';

export interface AnswerFlashcardRequestInput {
  userId: string;
  studySessionId: string;
  flashcardId: string;
  rating: ReviewRating;
  idempotencyKey: string;
  reviewedAt: Date;
  responseTimeMs?: number;
}
