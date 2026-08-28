import { MASTERY_CONSTANTS, MasteryStatus } from './mastery-score';

/**
 * Spaced retesting for weakness patterns — pure, deterministic, no DB and no
 * AI. Deliberately NOT SM-2/Anki: no ease factor, no per-item state, just a
 * fixed ladder of intervals plus three outcomes. Everything here is a
 * consumer of the mastery score (@lib/mistakes/mastery-score.ts); this
 * module never computes a second score of its own.
 *
 * The cycle it implements:
 *
 *   mistake -> targeted practice -> mastery rises -> wait -> retest
 *           -> retention confirmed (or not) -> interval grows (or shrinks)
 */

export const RETEST_CONSTANTS = {
  /**
   * Every interval the scheduler can ever choose, in days, ascending. A PASS
   * moves one rung up, so this ladder IS the streak counter — which is why
   * `consecutiveSuccessfulReviews` is recorded for analysis but never feeds
   * the formula.
   */
  INTERVAL_LADDER_DAYS: [1, 3, 7, 14, 30] as const,

  /**
   * The cap is one `ANSWER_HALF_LIFE_DAYS` (30): exactly the point where the
   * evidence behind a mastery score has lost half its weight and the score
   * starts sliding on its own, and the same window MASTERED already uses for
   * "no recent relapse". Waiting longer would test a score nobody trusts.
   */
  MAX_INTERVAL_DAYS: 30,

  /** Interval a pattern gets the first time it is scheduled, by status. */
  INITIAL_INTERVAL_DAYS: {
    [MasteryStatus.LEARNING]: 3,
    [MasteryStatus.STRONG]: 7,
    [MasteryStatus.MASTERED]: 14,
  } as Record<string, number>,

  /** After a failed retest: the pattern is retested again almost immediately. */
  FAILED_INTERVAL_DAYS: 3,
  /** ...or the very next day when the failure dropped it all the way to WEAK. */
  FAILED_WEAK_INTERVAL_DAYS: 1,

  /** Minimum accuracy for a PASS. */
  PASS_MIN_PERCENTAGE: 80,
  /** Below this, the retest is a FAIL rather than a PARTIAL. */
  PARTIAL_MIN_PERCENTAGE: 50,
  /**
   * A PASS also requires this many DISTINCT lexical families among the
   * correct answers. Answering "responsible -> responsibly" right three
   * times proves memory of one word, not retention of the pattern, so it
   * lands on PARTIAL (interval unchanged) instead of growing the interval.
   */
  PASS_MIN_DISTINCT_FAMILIES: 2,

  /**
   * A pattern only enters spaced retesting once it is genuinely being
   * learned: at least one correct remediation answer, and a mastery score
   * out of the WEAK band. Below that the right prescription is practice, not
   * a retention test — a WEAK pattern is one the student never learned in
   * the first place, so there is nothing to have forgotten.
   */
  MIN_MASTERY_TO_SCHEDULE: MASTERY_CONSTANTS.LEARNING_MIN_SCORE,
  MIN_REMEDIATION_CORRECT_TO_SCHEDULE: 1,

  /** Retest sizes. One pattern gets 3 items; a combined session gets 2 each. */
  ITEMS_PER_SINGLE_PATTERN: 3,
  ITEMS_PER_COMBINED_PATTERN: 2,
  /** A review session is a check-up, never a study marathon. */
  MAX_PATTERNS_PER_SESSION: 3,
} as const;

export enum RetestResult {
  PASS = 'pass',
  PARTIAL = 'partial',
  FAIL = 'fail',
}

/** Derived from `due_at` against the clock — never stored (see WeaknessReview). */
export enum ReviewTiming {
  UPCOMING = 'upcoming',
  DUE = 'due',
  OVERDUE = 'overdue',
}

const MS_PER_DAY = 86_400_000;

/** A pattern is only "overdue" once a full day has passed, not one second after midnight. */
const OVERDUE_AFTER_MS = MS_PER_DAY;

export interface RetestEligibilityInput {
  masteryScore: number;
  remediationCorrect: number;
}

/**
 * Whether a weakness pattern should be scheduled for retesting at all.
 * Applied both to first-time scheduling and to rescheduling after a retest:
 * a pattern that collapses below the bar stops being retested and goes back
 * to plain remediation.
 */
export function isEligibleForRetest(input: RetestEligibilityInput): boolean {
  return (
    input.remediationCorrect >= RETEST_CONSTANTS.MIN_REMEDIATION_CORRECT_TO_SCHEDULE &&
    input.masteryScore >= RETEST_CONSTANTS.MIN_MASTERY_TO_SCHEDULE
  );
}

/**
 * The interval a pattern gets the first time it is scheduled. WEAK has no
 * entry: `isEligibleForRetest` rejects it before this is ever reached, and
 * the 1-day rung exists only as somewhere to fall after a failed retest.
 */
export function initialIntervalDays(status: MasteryStatus): number {
  return RETEST_CONSTANTS.INITIAL_INTERVAL_DAYS[status] ?? RETEST_CONSTANTS.FAILED_INTERVAL_DAYS;
}

export interface GradeRetestInput {
  correctCount: number;
  totalCount: number;
  /** Distinct lexical families among the CORRECT answers — the transfer signal. */
  distinctCorrectFamilies: number;
}

/**
 * Turns a graded retest into one of three outcomes. Percentage bands rather
 * than raw counts, so the same rule reads identically for a 3-item single
 * pattern and a 6-item combined session.
 *
 * The family gate can only ever downgrade a PASS to a PARTIAL — never to a
 * FAIL. If the generator failed to vary the words (its instructions say it
 * must), the student keeps their interval instead of being punished for it.
 */
export function gradeRetest(input: GradeRetestInput): RetestResult {
  if (input.totalCount <= 0) return RetestResult.FAIL;

  const percentage = (input.correctCount / input.totalCount) * 100;

  if (percentage >= RETEST_CONSTANTS.PASS_MIN_PERCENTAGE) {
    return input.distinctCorrectFamilies >= RETEST_CONSTANTS.PASS_MIN_DISTINCT_FAMILIES
      ? RetestResult.PASS
      : RetestResult.PARTIAL;
  }
  if (percentage >= RETEST_CONSTANTS.PARTIAL_MIN_PERCENTAGE) return RetestResult.PARTIAL;
  return RetestResult.FAIL;
}

export interface NextIntervalInput {
  currentIntervalDays: number;
  result: RetestResult;
  /** Mastery status AFTER the retest's own evidence was folded in. */
  statusAfter: MasteryStatus;
}

/**
 * PASS  -> one rung up the ladder (capped).
 * PARTIAL -> the same interval: retention was neither confirmed nor lost.
 * FAIL  -> straight back to a short interval, 1 day if the pattern collapsed
 *          to WEAK. Not a reset to zero — the pattern keeps its history,
 *          only its next check-up moves closer.
 */
export function nextIntervalDays(input: NextIntervalInput): number {
  const ladder = RETEST_CONSTANTS.INTERVAL_LADDER_DAYS;

  if (input.result === RetestResult.FAIL) {
    return input.statusAfter === MasteryStatus.WEAK
      ? RETEST_CONSTANTS.FAILED_WEAK_INTERVAL_DAYS
      : RETEST_CONSTANTS.FAILED_INTERVAL_DAYS;
  }

  if (input.result === RetestResult.PARTIAL) {
    return clampToLadder(input.currentIntervalDays);
  }

  const currentIndex = ladder.indexOf(clampToLadder(input.currentIntervalDays) as never);
  const nextIndex = Math.min(currentIndex + 1, ladder.length - 1);
  return ladder[nextIndex];
}

/**
 * Snaps an arbitrary interval onto the ladder — a row written by an older
 * version of this table (or a hand-edited one) must never make the ladder
 * arithmetic fall off the end.
 */
function clampToLadder(days: number): number {
  const ladder = RETEST_CONSTANTS.INTERVAL_LADDER_DAYS;
  for (const rung of ladder) {
    if (days <= rung) return rung;
  }
  return RETEST_CONSTANTS.MAX_INTERVAL_DAYS;
}

/** `from + days`, in UTC. Due dates are stored and compared in UTC; only the client localizes them. */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}

export function resolveTiming(dueAt: Date, now: Date): ReviewTiming {
  const overdueBy = now.getTime() - dueAt.getTime();
  if (overdueBy >= OVERDUE_AFTER_MS) return ReviewTiming.OVERDUE;
  if (overdueBy >= 0) return ReviewTiming.DUE;
  return ReviewTiming.UPCOMING;
}

/**
 * How many items a review session should generate. A single pattern gets a
 * proper 3-item check (easier transfer / normal B2 transfer / different
 * context); several due patterns share a 2-each session, capped so a review
 * never turns into a full practice set.
 */
export function retestItemCount(patternCount: number): number {
  if (patternCount <= 1) return RETEST_CONSTANTS.ITEMS_PER_SINGLE_PATTERN;
  const capped = Math.min(patternCount, RETEST_CONSTANTS.MAX_PATTERNS_PER_SESSION);
  return capped * RETEST_CONSTANTS.ITEMS_PER_COMBINED_PATTERN;
}
