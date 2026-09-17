import type { EntityManager } from 'typeorm';
import { WeaknessReviewsRepository } from '@repositories/mistakes/weakness-reviews.repository';
import type { ReviewPatternIdentity } from '@repositories/mistakes/weakness-reviews.repository';
import { MistakeMasteryRepository } from '@repositories/mistakes/mistake-mastery.repository';
import { WeaknessReviewResult } from '../../models/enums';
import type { MistakeErrorType, MistakeErrorSubtype } from '../../models/enums';
import type {
  PracticeItemMetadata,
  PracticeExerciseGenerationMetadata,
} from '../../models/practice-json-types';
import { buildPatternKey } from '@lib/mistakes/mistake-pattern';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import {
  RetestResult,
  addDays,
  gradeRetest,
  initialIntervalDays,
  isEligibleForRetest,
  nextIntervalDays,
} from '@lib/mistakes/retest-scheduler';
import { computeWeaknessProfiles } from './compute-weakness-profiles';
import type { WeaknessProfileDeps } from './compute-weakness-profiles';
import { getUserTimeZone } from '../planning/resolve-user-local-day';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';
import type { ReviewOutcomeDto } from '../../interfaces/mistakes/reviews.interface';

/** One graded item of the submitted attempt, as the submit service already has it. */
export interface SyncGradedItem {
  metadata: PracticeItemMetadata | null;
  isCorrect: boolean;
  /** Falls back to the family when the generator could not extract one — same COALESCE the mastery query uses. */
  normalizedAnswer: string | null;
}

export interface SyncWeaknessReviewsInput {
  userId: string;
  attemptId: string;
  exerciseId: string;
  partCode: string;
  generationMetadata: PracticeExerciseGenerationMetadata | null;
  items: SyncGradedItem[];
  submittedAt: Date;
}

export interface WeaknessReviewsRepositoryPort {
  upsertScheduled(data: Parameters<WeaknessReviewsRepository['upsertScheduled']>[0]): Promise<void>;
  findScheduledForUser(
    userId: string,
  ): ReturnType<WeaknessReviewsRepository['findScheduledForUser']>;
  findByIdForUser(
    userId: string,
    id: string,
  ): ReturnType<WeaknessReviewsRepository['findByIdForUser']>;
  complete(data: Parameters<WeaknessReviewsRepository['complete']>[0]): Promise<boolean>;
  cancelScheduled(userId: string, identity: ReviewPatternIdentity): Promise<void>;
}

export interface SyncWeaknessReviewsServiceDeps {
  reviews?: (manager: EntityManager) => WeaknessReviewsRepositoryPort;
  /** Injectable seam for tests — the default derives profiles on the caller's transaction. */
  weaknessProfiles?: (
    manager: EntityManager,
    userId: string,
    partCode: string,
    now: Date,
  ) => Promise<WeaknessDto[]>;
}

const DEFAULT_REVIEWS_FACTORY = (manager: EntityManager): WeaknessReviewsRepositoryPort =>
  new WeaknessReviewsRepository(manager);

const DEFAULT_WEAKNESS_PROFILES = (
  manager: EntityManager,
  userId: string,
  partCode: string,
  now: Date,
): Promise<WeaknessDto[]> => {
  const deps: WeaknessProfileDeps = {
    repository: new MistakeMasteryRepository(manager),
    resolveTimeZone: (id) => getUserTimeZone(manager, id),
    now: () => now,
  };
  // Filtered to the submitted exercise's own part: a submission can only ever
  // change the evidence of patterns inside it, so there is no reason to
  // re-score the user's whole history on every submit.
  return computeWeaknessProfiles(deps, userId, { partCode });
};

const RESULT_TO_ENUM: Record<RetestResult, WeaknessReviewResult> = {
  [RetestResult.PASS]: WeaknessReviewResult.PASS,
  [RetestResult.PARTIAL]: WeaknessReviewResult.PARTIAL,
  [RetestResult.FAIL]: WeaknessReviewResult.FAIL,
};

interface RetestTally {
  reviewId: string;
  correctCount: number;
  totalCount: number;
  correctFamilies: Set<string>;
}

/**
 * The scheduling half of spaced retesting, run inside the submitting
 * transaction (see SubmitPracticeAttemptService) right after the Mistake
 * Bank has recorded that submission's evidence — so every score it reads
 * already includes the answers being submitted.
 *
 * It closes any review the attempt was a retest for, and keeps the user's
 * scheduled reviews in step with what they now know. It computes **no score
 * of its own**: mastery stays the single source of truth
 * (computeWeaknessProfiles), and this only decides *when to look again*.
 */
export class SyncWeaknessReviewsService {
  constructor(private readonly deps: SyncWeaknessReviewsServiceDeps = {}) {}

  async sync(manager: EntityManager, input: SyncWeaknessReviewsInput): Promise<ReviewOutcomeDto[]> {
    const source = input.generationMetadata?.generationSource;
    // A plain practice submission never touches reviews. Only sessions built
    // FROM the Mistake Bank carry remediation evidence, and only those can
    // make a pattern eligible or close a retest.
    if (source !== 'mistake_practice' && source !== 'spaced_retest') return [];

    const reviews = (this.deps.reviews ?? DEFAULT_REVIEWS_FACTORY)(manager);
    const profilesFor = this.deps.weaknessProfiles ?? DEFAULT_WEAKNESS_PROFILES;
    const profiles = await profilesFor(manager, input.userId, input.partCode, input.submittedAt);
    const profileByPattern = new Map(profiles.map((p) => [buildPatternKey(p), p]));

    const outcomes =
      source === 'spaced_retest'
        ? await this.completeRetests(reviews, input, profileByPattern)
        : [];

    const handled = new Set(outcomes.map((outcome) => outcome.patternKey));
    await this.scheduleNewlyEligible(reviews, input, profiles, handled);

    return outcomes.map(({ patternKey: _patternKey, ...outcome }) => outcome);
  }

  /**
   * Grades every review this attempt was a retest for, closes it, and books
   * the follow-up. Reviews are identified only by the `scheduledReviewId`
   * the generator wrote into each item's metadata — never by anything the
   * client sent — and every lookup is ownership-checked.
   */
  private async completeRetests(
    reviews: WeaknessReviewsRepositoryPort,
    input: SyncWeaknessReviewsInput,
    profileByPattern: Map<string, WeaknessDto>,
  ): Promise<Array<ReviewOutcomeDto & { patternKey: string }>> {
    const tallies = tallyByReview(input.items);
    const outcomes: Array<ReviewOutcomeDto & { patternKey: string }> = [];

    for (const tally of tallies) {
      const review = await reviews.findByIdForUser(input.userId, tally.reviewId);
      // Missing, already completed, or someone else's — all treated the same
      // way: silently skipped. A replayed submission must not re-grade a
      // review, and a forged id must not reveal whether it exists.
      if (review === null || review.status !== 'scheduled') continue;

      const identity: ReviewPatternIdentity = {
        skillSlug: review.skill_slug,
        examCode: review.exam_code,
        paperCode: review.paper_code,
        partCode: review.part_code,
        errorType: review.error_type,
        errorSubtype: review.error_subtype,
      };
      const patternKey = buildPatternKey({
        partCode: review.part_code,
        errorType: review.error_type,
        errorSubtype: review.error_subtype,
      });
      const profile = profileByPattern.get(patternKey);
      // The retest's own answers are already recorded, so a profile must
      // exist. If it somehow does not, fall back to the snapshot rather than
      // inventing a score.
      const masteryAfter = profile?.masteryScore ?? review.mastery_score_before;
      const statusAfter = profile?.status ?? MasteryStatus.LEARNING;

      const result = gradeRetest({
        correctCount: tally.correctCount,
        totalCount: tally.totalCount,
        distinctCorrectFamilies: tally.correctFamilies.size,
      });

      const closed = await reviews.complete({
        reviewId: review.id,
        userId: input.userId,
        completedAt: input.submittedAt,
        result: RESULT_TO_ENUM[result],
        correctCount: tally.correctCount,
        totalCount: tally.totalCount,
        distinctCorrectFamilies: tally.correctFamilies.size,
        masteryScoreAfter: masteryAfter,
        practiceExerciseId: input.exerciseId,
        practiceAttemptId: input.attemptId,
      });
      // Lost the race with a concurrent submission of the same attempt — the
      // other one already booked the follow-up.
      if (!closed) continue;

      const intervalDays = nextIntervalDays({
        currentIntervalDays: review.interval_days,
        result,
        statusAfter,
      });
      const consecutive =
        result === RetestResult.PASS ? review.consecutive_successful_reviews + 1 : 0;
      const nextReviewAt = addDays(input.submittedAt, intervalDays);

      // A pattern that collapsed out of eligibility goes back to plain
      // remediation instead of being retested again.
      if (isEligibleForRetest({ masteryScore: masteryAfter, remediationCorrect: 1 })) {
        await reviews.upsertScheduled({
          userId: input.userId,
          ...identity,
          dueAt: nextReviewAt,
          intervalDays,
          consecutiveSuccessfulReviews: consecutive,
          masteryScoreBefore: masteryAfter,
        });
      }

      outcomes.push({
        patternKey,
        reviewId: review.id,
        result,
        errorType: review.error_type,
        errorSubtype: review.error_subtype,
        partCode: review.part_code,
        correctCount: tally.correctCount,
        totalCount: tally.totalCount,
        distinctCorrectFamilies: tally.correctFamilies.size,
        masteryScoreBefore: review.mastery_score_before,
        masteryScoreAfter: masteryAfter,
        masteryStatusAfter: statusAfter,
        nextReviewAt,
        nextIntervalDays: intervalDays,
      });
    }

    return outcomes;
  }

  /**
   * First-time scheduling, and retirement.
   *
   * A pattern that just became eligible gets its first check-up. One that
   * already has a scheduled review is left completely alone: only a real
   * retest moves the ladder, so practising voluntarily can neither postpone
   * a retest (also guaranteed in SQL by the `LEAST` in upsertScheduled) nor
   * quietly undo a hard-won longer interval. A pattern that fell out of
   * eligibility has its review cancelled — it needs practice, not a
   * retention test.
   */
  private async scheduleNewlyEligible(
    reviews: WeaknessReviewsRepositoryPort,
    input: SyncWeaknessReviewsInput,
    profiles: WeaknessDto[],
    handled: Set<string>,
  ): Promise<void> {
    const scheduled = await reviews.findScheduledForUser(input.userId);
    const scheduledKeys = new Set(
      scheduled.map((review) =>
        buildPatternKey({
          partCode: review.part_code,
          errorType: review.error_type,
          errorSubtype: review.error_subtype,
        }),
      ),
    );

    for (const profile of profiles) {
      const patternKey = buildPatternKey(profile);
      if (handled.has(patternKey)) continue;

      const identity: ReviewPatternIdentity = {
        skillSlug: profile.skill,
        examCode: profile.examCode,
        paperCode: profile.paperCode,
        partCode: profile.partCode,
        errorType: profile.errorType as MistakeErrorType,
        errorSubtype: profile.errorSubtype as MistakeErrorSubtype | null,
      };

      const eligible = isEligibleForRetest({
        masteryScore: profile.masteryScore,
        remediationCorrect: profile.remediationCorrect,
      });

      if (!eligible) {
        if (scheduledKeys.has(patternKey)) {
          await reviews.cancelScheduled(input.userId, identity);
        }
        continue;
      }
      if (scheduledKeys.has(patternKey)) continue;

      const intervalDays = initialIntervalDays(profile.status);
      // Anchored on the last practice, not on "now": a pattern that became
      // eligible ten days ago and was never touched again is genuinely
      // overdue, and should say so rather than restarting its clock.
      const anchor = profile.lastPracticedAt ?? input.submittedAt;
      await reviews.upsertScheduled({
        userId: input.userId,
        ...identity,
        dueAt: addDays(anchor, intervalDays),
        intervalDays,
        consecutiveSuccessfulReviews: 0,
        masteryScoreBefore: profile.masteryScore,
      });
    }
  }
}

/**
 * Groups the attempt's items by the review they were generated for. The
 * lexical family of a correct answer is the item's own `itemBaseWord`,
 * falling back to what the student actually wrote — the same COALESCE the
 * mastery aggregation uses, so "distinct families" means one thing across
 * the whole module.
 */
function tallyByReview(items: SyncGradedItem[]): RetestTally[] {
  const byReview = new Map<string, RetestTally>();

  for (const item of items) {
    const metadata = item.metadata as Record<string, unknown> | null;
    const reviewId = metadata?.['scheduledReviewId'];
    if (typeof reviewId !== 'string' || reviewId === '') continue;

    const tally = byReview.get(reviewId) ?? {
      reviewId,
      correctCount: 0,
      totalCount: 0,
      correctFamilies: new Set<string>(),
    };
    tally.totalCount += 1;
    if (item.isCorrect) {
      tally.correctCount += 1;
      const rawFamily = metadata?.['itemBaseWord'];
      const family =
        typeof rawFamily === 'string' && rawFamily !== '' ? rawFamily : item.normalizedAnswer;
      if (family !== null && family !== '') tally.correctFamilies.add(family.toLowerCase());
    }
    byReview.set(reviewId, tally);
  }

  return [...byReview.values()];
}
