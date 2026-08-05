import type { FlashcardStatus, ReviewRating } from '../../../models/enums';

export interface FlashcardSchedulingState {
  status: FlashcardStatus;
  intervalMinutes: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
}

export interface SchedulingResult {
  status: FlashcardStatus;
  intervalMinutes: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  nextReviewAt: Date;
}

export interface SchedulingStrategy {
  calculate(
    currentState: FlashcardSchedulingState,
    rating: ReviewRating,
    reviewedAt: Date,
  ): SchedulingResult;
}

export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingError';
  }
}
