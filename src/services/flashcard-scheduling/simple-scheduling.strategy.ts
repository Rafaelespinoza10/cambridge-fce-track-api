import { FlashcardStatus, ReviewRating } from '../../models/enums';
import {
  SchedulingError,
  type FlashcardSchedulingState,
  type SchedulingResult,
  type SchedulingStrategy,
} from './scheduling.types';

// Constantes del MVP
// Unidad canónica: minutos. No es SM-2 — es una curva simplificada e
// intencionalmente reemplazable por FSRS/SM-2 real implementando SchedulingStrategy.

const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.0;

const MINUTES_PER_DAY = 24 * 60;
const AGAIN_INTERVAL_MINUTES = 10;
const FIRST_HARD_INTERVAL_MINUTES = 1 * MINUTES_PER_DAY;
const FIRST_GOOD_INTERVAL_MINUTES = 3 * MINUTES_PER_DAY;
const FIRST_EASY_INTERVAL_MINUTES = 7 * MINUTES_PER_DAY;
const MAX_INTERVAL_MINUTES = 10 * 365 * MINUTES_PER_DAY;

const AGAIN_EASE_DELTA = 0.2;
const HARD_EASE_DELTA = 0.05;
const EASY_EASE_DELTA = 0.15;

const HARD_INTERVAL_MULTIPLIER = 1.2;
const EASY_INTERVAL_MULTIPLIER = 1.3;

const VALID_STATUSES = new Set<string>(Object.values(FlashcardStatus));
const VALID_RATINGS = new Set<string>(Object.values(ReviewRating));

function isNewOrLearning(status: FlashcardStatus): boolean {
  return status === FlashcardStatus.NEW || status === FlashcardStatus.LEARNING;
}

function clampEase(value: number): number {
  return Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, value));
}

function clampInterval(minutes: number): number {
  return Math.min(MAX_INTERVAL_MINUTES, minutes);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function validateState(state: FlashcardSchedulingState): void {
  if (!VALID_STATUSES.has(state.status)) {
    throw new SchedulingError(`Invalid flashcard status: ${String(state.status)}`);
  }
  if (state.status === FlashcardStatus.SUSPENDED) {
    throw new SchedulingError('Cannot schedule a suspended flashcard');
  }
  if (!Number.isInteger(state.intervalMinutes) || state.intervalMinutes < 0) {
    throw new SchedulingError('intervalMinutes must be a non-negative integer');
  }
  if (
    typeof state.easeFactor !== 'number' ||
    Number.isNaN(state.easeFactor) ||
    state.easeFactor < MIN_EASE_FACTOR ||
    state.easeFactor > MAX_EASE_FACTOR
  ) {
    throw new SchedulingError(
      `easeFactor must be a number between ${MIN_EASE_FACTOR} and ${MAX_EASE_FACTOR}`,
    );
  }
  if (!Number.isInteger(state.repetitions) || state.repetitions < 0) {
    throw new SchedulingError('repetitions must be a non-negative integer');
  }
  if (!Number.isInteger(state.lapses) || state.lapses < 0) {
    throw new SchedulingError('lapses must be a non-negative integer');
  }
}

function validateRating(rating: ReviewRating): void {
  if (!VALID_RATINGS.has(rating)) {
    throw new SchedulingError(`Invalid rating: ${String(rating)}`);
  }
}

function validateReviewedAt(reviewedAt: Date): void {
  if (!(reviewedAt instanceof Date) || Number.isNaN(reviewedAt.getTime())) {
    throw new SchedulingError('reviewedAt must be a valid Date');
  }
}

export class SimpleSchedulingStrategy implements SchedulingStrategy {
  calculate(
    currentState: FlashcardSchedulingState,
    rating: ReviewRating,
    reviewedAt: Date,
  ): SchedulingResult {
    validateState(currentState);
    validateRating(rating);
    validateReviewedAt(reviewedAt);

    switch (rating) {
      case ReviewRating.AGAIN:
        return this.calculateAgain(currentState, reviewedAt);
      case ReviewRating.HARD:
        return this.calculateHard(currentState, reviewedAt);
      case ReviewRating.GOOD:
        return this.calculateGood(currentState, reviewedAt);
      case ReviewRating.EASY:
        return this.calculateEasy(currentState, reviewedAt);
      default:
        throw new SchedulingError(`Unhandled rating: ${String(rating)}`);
    }
  }

  private calculateAgain(state: FlashcardSchedulingState, reviewedAt: Date): SchedulingResult {
    const intervalMinutes = clampInterval(AGAIN_INTERVAL_MINUTES);
    return {
      status: FlashcardStatus.LEARNING,
      intervalMinutes,
      easeFactor: clampEase(state.easeFactor - AGAIN_EASE_DELTA),
      repetitions: 0,
      lapses: state.lapses + 1,
      nextReviewAt: addMinutes(reviewedAt, intervalMinutes),
    };
  }

  private calculateHard(state: FlashcardSchedulingState, reviewedAt: Date): SchedulingResult {
    const wasNewOrLearning = isNewOrLearning(state.status);
    const intervalMinutes = clampInterval(
      wasNewOrLearning
        ? FIRST_HARD_INTERVAL_MINUTES
        : Math.max(
            FIRST_HARD_INTERVAL_MINUTES,
            Math.round(state.intervalMinutes * HARD_INTERVAL_MULTIPLIER),
          ),
    );

    return {
      status: wasNewOrLearning ? FlashcardStatus.LEARNING : FlashcardStatus.REVIEW,
      intervalMinutes,
      easeFactor: clampEase(state.easeFactor - HARD_EASE_DELTA),
      repetitions: state.repetitions + 1,
      lapses: state.lapses,
      nextReviewAt: addMinutes(reviewedAt, intervalMinutes),
    };
  }

  private calculateGood(state: FlashcardSchedulingState, reviewedAt: Date): SchedulingResult {
    const wasNewOrLearning = isNewOrLearning(state.status);
    const intervalMinutes = clampInterval(
      wasNewOrLearning
        ? FIRST_GOOD_INTERVAL_MINUTES
        : Math.max(
            FIRST_GOOD_INTERVAL_MINUTES,
            Math.round(state.intervalMinutes * state.easeFactor),
          ),
    );

    return {
      status: FlashcardStatus.REVIEW,
      intervalMinutes,
      easeFactor: state.easeFactor,
      repetitions: state.repetitions + 1,
      lapses: state.lapses,
      nextReviewAt: addMinutes(reviewedAt, intervalMinutes),
    };
  }

  private calculateEasy(state: FlashcardSchedulingState, reviewedAt: Date): SchedulingResult {
    const wasNewOrLearning = isNewOrLearning(state.status);
    const intervalMinutes = clampInterval(
      wasNewOrLearning
        ? FIRST_EASY_INTERVAL_MINUTES
        : Math.max(
            FIRST_EASY_INTERVAL_MINUTES,
            Math.round(state.intervalMinutes * state.easeFactor * EASY_INTERVAL_MULTIPLIER),
          ),
    );

    return {
      status: FlashcardStatus.REVIEW,
      intervalMinutes,
      easeFactor: clampEase(state.easeFactor + EASY_EASE_DELTA),
      repetitions: state.repetitions + 1,
      lapses: state.lapses,
      nextReviewAt: addMinutes(reviewedAt, intervalMinutes),
    };
  }
}
