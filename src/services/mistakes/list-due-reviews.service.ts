import { buildPatternKey } from '@lib/mistakes/mistake-pattern';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import { ReviewTiming, resolveTiming } from '@lib/mistakes/retest-scheduler';
import type { WeaknessReview } from '../../models/WeaknessReview';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';
import type {
  DueReviewDto,
  ListReviewsResponseDto,
} from '../../interfaces/mistakes/reviews.interface';

export enum ListReviewsErrorCode {
  INVALID_INPUT = 'invalid_input',
}

export class ListReviewsError extends Error {
  constructor(
    message: string,
    readonly code: ListReviewsErrorCode,
  ) {
    super(message);
    this.name = 'ListReviewsError';
  }
}

/** Raw query-string values — everything API Gateway hands the controller is a string or undefined. */
export interface ListReviewsRawQuery {
  status?: string;
}

export type ReviewStatusFilter = 'due' | 'upcoming' | 'all';

export interface WeaknessReviewsReadPort {
  findScheduledForUser(userId: string): Promise<WeaknessReview[]>;
}

export interface ListReviewsServiceDeps {
  reviews: WeaknessReviewsReadPort;
  /** Live mastery for the user's patterns — the list shows today's score, not the scheduling snapshot. */
  weaknessProfiles: (userId: string, now: Date) => Promise<WeaknessDto[]>;
  now?: () => Date;
}

const VALID_STATUSES = new Set<string>(['due', 'upcoming', 'all']);
/** Runaway guard, not pagination: a user has a handful of patterns, not thousands. */
const MAX_ITEMS = 100;

/**
 * The user's scheduled retests, most urgent first.
 *
 * `userId` is a parameter, never a filter the caller can drop — the
 * repository read is scoped by it, so no code path can surface another
 * user's reviews. Everything is UTC; turning `dueAt` into "Today" or
 * "2 days overdue" is the client's job, in the device's own zone.
 */
export class ListDueReviewsService {
  constructor(private readonly deps: ListReviewsServiceDeps) {}

  async execute(userId: string, rawQuery: ListReviewsRawQuery): Promise<ListReviewsResponseDto> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new ListReviewsError('userId is required', ListReviewsErrorCode.INVALID_INPUT);
    }
    const statusFilter = this.resolveStatusFilter(rawQuery.status);
    const now = (this.deps.now ?? (() => new Date()))();

    const [scheduled, profiles] = await Promise.all([
      this.deps.reviews.findScheduledForUser(userId),
      this.deps.weaknessProfiles(userId, now),
    ]);
    const profileByPattern = new Map(
      profiles.map((profile) => [buildPatternKey(profile), profile]),
    );

    const all = scheduled.map((review) => toDto(review, profileByPattern, now));
    const dueCount = all.filter((item) => item.timing !== ReviewTiming.UPCOMING).length;

    const items = all
      .filter((item) => matchesFilter(item, statusFilter))
      .sort(mostUrgentFirst)
      .slice(0, MAX_ITEMS);

    return { items, dueCount, totalItems: all.length };
  }

  private resolveStatusFilter(raw: string | undefined): ReviewStatusFilter {
    if (raw === undefined) return 'all';
    const status = raw.trim().toLowerCase();
    if (!VALID_STATUSES.has(status)) {
      throw new ListReviewsError(
        `status must be one of: ${[...VALID_STATUSES].join(', ')}`,
        ListReviewsErrorCode.INVALID_INPUT,
      );
    }
    return status as ReviewStatusFilter;
  }
}

function toDto(
  review: WeaknessReview,
  profileByPattern: Map<string, WeaknessDto>,
  now: Date,
): DueReviewDto {
  const profile = profileByPattern.get(
    buildPatternKey({
      partCode: review.part_code,
      errorType: review.error_type,
      errorSubtype: review.error_subtype,
    }),
  );

  return {
    reviewId: review.id,
    skill: review.skill_slug,
    examCode: review.exam_code,
    paperCode: review.paper_code,
    partCode: review.part_code,
    errorType: review.error_type,
    errorSubtype: review.error_subtype,
    dueAt: review.due_at,
    timing: resolveTiming(review.due_at, now),
    intervalDays: review.interval_days,
    consecutiveSuccessfulReviews: review.consecutive_successful_reviews,
    // Falls back to the snapshot taken when the review was scheduled — only
    // reachable if every mistake behind the pattern was somehow removed.
    masteryScore: profile?.masteryScore ?? review.mastery_score_before,
    masteryStatus: profile?.status ?? MasteryStatus.LEARNING,
  };
}

function matchesFilter(item: DueReviewDto, filter: ReviewStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'due') return item.timing !== ReviewTiming.UPCOMING;
  return item.timing === ReviewTiming.UPCOMING;
}

/**
 * Overdue first, then the least-mastered pattern, then the oldest due date —
 * the order the plan specifies, and the order a combined session picks its
 * patterns in.
 */
function mostUrgentFirst(a: DueReviewDto, b: DueReviewDto): number {
  const rank = (item: DueReviewDto): number =>
    item.timing === ReviewTiming.OVERDUE ? 0 : item.timing === ReviewTiming.DUE ? 1 : 2;

  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.masteryScore !== b.masteryScore) return a.masteryScore - b.masteryScore;
  if (a.dueAt.getTime() !== b.dueAt.getTime()) return a.dueAt.getTime() - b.dueAt.getTime();
  return a.reviewId.localeCompare(b.reviewId);
}
