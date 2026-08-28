import type { MistakeErrorType, MistakeErrorSubtype } from '../../models/enums';
import type { MasteryStatus } from '@lib/mistakes/mastery-score';
import type { RetestResult, ReviewTiming } from '@lib/mistakes/retest-scheduler';

/**
 * One scheduled retest as the client sees it — never `userId`, and never the
 * mistakes or practice answers the pattern was built from.
 *
 * `dueAt` is UTC, like every timestamp this API returns. "Today" / "in 3
 * days" / "2 days overdue" are the client's job, in the device's own zone;
 * `timing` is only the coarse bucket the backend is sure about.
 */
export interface DueReviewDto {
  reviewId: string;

  skill: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;

  dueAt: Date;
  timing: ReviewTiming;
  intervalDays: number;
  consecutiveSuccessfulReviews: number;

  /** Live mastery for the pattern, recomputed now — not the snapshot taken when it was scheduled. */
  masteryScore: number;
  masteryStatus: MasteryStatus;
}

export interface ListReviewsResponseDto {
  items: DueReviewDto[];
  /** How many of `items` can be practised right now — what the Home badge shows. */
  dueCount: number;
  totalItems: number;
}

/**
 * The outcome of a retest, attached to the graded attempt it was answered
 * through. Present only when the attempt actually completed a review, so a
 * normal practice submission is unchanged.
 */
export interface ReviewOutcomeDto {
  reviewId: string;
  result: RetestResult;

  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  partCode: string;

  correctCount: number;
  totalCount: number;
  distinctCorrectFamilies: number;

  /** The "78% -> 84%" of the completion screen. */
  masteryScoreBefore: number;
  masteryScoreAfter: number;
  masteryStatusAfter: MasteryStatus;

  /** The follow-up this result just scheduled. */
  nextReviewAt: Date;
  nextIntervalDays: number;
}
