import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ListDueReviewsService,
  ListReviewsError,
  ListReviewsErrorCode,
} from './list-due-reviews.service';
import type { WeaknessReviewsReadPort } from './list-due-reviews.service';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';
import type { WeaknessReview } from '../../models/WeaknessReview';
import { MistakeErrorType, MistakeErrorSubtype, WeaknessReviewStatus } from '../../models/enums';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import { ReviewTiming } from '@lib/mistakes/retest-scheduler';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

function review(overrides: Partial<WeaknessReview> = {}): WeaknessReview {
  return {
    id: 'review-1',
    user_id: USER_ID,
    skill_slug: 'use-of-english',
    exam_code: 'B2_FIRST',
    paper_code: 'PAPER_1',
    part_code: 'UOE_PART_3',
    error_type: MistakeErrorType.WORD_CLASS,
    error_subtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    status: WeaknessReviewStatus.SCHEDULED,
    due_at: NOW,
    interval_days: 7,
    consecutive_successful_reviews: 1,
    mastery_score_before: 78,
    completed_at: null,
    result: null,
    correct_count: null,
    total_count: null,
    distinct_correct_families: null,
    mastery_score_after: null,
    practice_exercise_id: null,
    practice_attempt_id: null,
    ...overrides,
  } as WeaknessReview;
}

function profile(overrides: Partial<WeaknessDto> = {}): WeaknessDto {
  return {
    skill: 'use-of-english',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    masteryScore: 81,
    status: MasteryStatus.STRONG,
    timesWrong: 4,
    conceptCount: 2,
    remediationAttempts: 8,
    remediationCorrect: 7,
    distinctBaseWords: 3,
    distinctPracticeDays: 3,
    firstSeenAt: daysFromNow(-30),
    lastWrongAt: daysFromNow(-20),
    lastPracticedAt: daysFromNow(-7),
    masteredBlocked: false,
    ...overrides,
  };
}

function makeService(options: { reviews?: WeaknessReview[]; profiles?: WeaknessDto[] } = {}): {
  service: ListDueReviewsService;
  calls: { reviews: string[]; profiles: string[] };
} {
  const calls = { reviews: [] as string[], profiles: [] as string[] };
  const reviews: WeaknessReviewsReadPort = {
    async findScheduledForUser(userId) {
      calls.reviews.push(userId);
      return options.reviews ?? [review()];
    },
  };
  const service = new ListDueReviewsService({
    reviews,
    weaknessProfiles: async (userId) => {
      calls.profiles.push(userId);
      return options.profiles ?? [profile()];
    },
    now: () => NOW,
  });
  return { service, calls };
}

describe('ListDueReviewsService — timing', () => {
  it('marks a review due the moment it comes due', async () => {
    const { service } = makeService({ reviews: [review({ due_at: NOW })] });

    const { items, dueCount } = await service.execute(USER_ID, {});

    assert.equal(items[0].timing, ReviewTiming.DUE);
    assert.equal(dueCount, 1);
  });

  it('marks a review overdue once a full day has passed', async () => {
    const { service } = makeService({ reviews: [review({ due_at: daysFromNow(-2) })] });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].timing, ReviewTiming.OVERDUE);
  });

  it('marks a future review upcoming and keeps it out of the due count', async () => {
    const { service } = makeService({ reviews: [review({ due_at: daysFromNow(3) })] });

    const { items, dueCount } = await service.execute(USER_ID, {});

    assert.equal(items[0].timing, ReviewTiming.UPCOMING);
    assert.equal(dueCount, 0);
  });
});

describe('ListDueReviewsService — ordering', () => {
  it('puts overdue reviews before merely due ones', async () => {
    const { service } = makeService({
      reviews: [
        review({ id: 'due-today', due_at: NOW }),
        review({ id: 'overdue', due_at: daysFromNow(-3) }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.deepEqual(
      items.map((item) => item.reviewId),
      ['overdue', 'due-today'],
    );
  });

  it('breaks a timing tie on the least-mastered pattern', async () => {
    const { service } = makeService({
      reviews: [
        review({ id: 'strong', due_at: NOW }),
        review({
          id: 'weak',
          due_at: NOW,
          error_subtype: MistakeErrorSubtype.NOUN_TO_ADVERB,
        }),
      ],
      profiles: [
        profile({ masteryScore: 81 }),
        profile({ masteryScore: 44, errorSubtype: MistakeErrorSubtype.NOUN_TO_ADVERB }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.deepEqual(
      items.map((item) => item.reviewId),
      ['weak', 'strong'],
    );
  });

  it('breaks a mastery tie on the oldest due date', async () => {
    const { service } = makeService({
      reviews: [
        review({ id: 'newer', due_at: daysFromNow(-2) }),
        review({
          id: 'older',
          due_at: daysFromNow(-5),
          error_subtype: MistakeErrorSubtype.NOUN_TO_ADVERB,
        }),
      ],
      profiles: [profile(), profile({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADVERB })],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].reviewId, 'older');
  });
});

describe('ListDueReviewsService — shape and filters', () => {
  it('reports the live mastery score, not the snapshot taken when it was scheduled', async () => {
    const { service } = makeService({
      reviews: [review({ mastery_score_before: 78 })],
      profiles: [profile({ masteryScore: 64, status: MasteryStatus.LEARNING })],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].masteryScore, 64);
    assert.equal(items[0].masteryStatus, MasteryStatus.LEARNING);
  });

  it('falls back to the snapshot when the pattern has no live profile left', async () => {
    const { service } = makeService({ reviews: [review()], profiles: [] });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].masteryScore, 78);
  });

  it('never exposes the owner', async () => {
    const { service } = makeService();

    const { items } = await service.execute(USER_ID, {});

    assert.equal(Object.prototype.hasOwnProperty.call(items[0], 'userId'), false);
    assert.equal(items[0].intervalDays, 7);
    assert.equal(items[0].consecutiveSuccessfulReviews, 1);
  });

  it('filters to what can be practised now', async () => {
    const { service } = makeService({
      reviews: [
        review({ id: 'due', due_at: NOW }),
        review({ id: 'later', due_at: daysFromNow(5) }),
      ],
    });

    const { items, totalItems } = await service.execute(USER_ID, { status: 'due' });

    assert.deepEqual(
      items.map((item) => item.reviewId),
      ['due'],
    );
    assert.equal(totalItems, 2, 'totalItems counts every scheduled review, filtered or not');
  });

  it('filters to what is still coming', async () => {
    const { service } = makeService({
      reviews: [
        review({ id: 'due', due_at: NOW }),
        review({ id: 'later', due_at: daysFromNow(5) }),
      ],
    });

    const { items } = await service.execute(USER_ID, { status: 'upcoming' });

    assert.deepEqual(
      items.map((item) => item.reviewId),
      ['later'],
    );
  });

  it('returns an empty list when nothing is scheduled', async () => {
    const { service } = makeService({ reviews: [] });

    const result = await service.execute(USER_ID, {});

    assert.deepEqual(result, { items: [], dueCount: 0, totalItems: 0 });
  });

  it('rejects an unknown status filter', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { status: 'somedaymaybe' }),
      (err: unknown) => {
        assert.ok(err instanceof ListReviewsError);
        assert.equal(err.code, ListReviewsErrorCode.INVALID_INPUT);
        return true;
      },
    );
  });
});

describe('ListDueReviewsService — ownership', () => {
  it('scopes every read to the caller', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, {});
    await service.execute(OTHER_USER_ID, {});

    assert.deepEqual(calls.reviews, [USER_ID, OTHER_USER_ID]);
    assert.deepEqual(calls.profiles, [USER_ID, OTHER_USER_ID]);
  });

  it('rejects a missing userId before touching the repository', async () => {
    const { service, calls } = makeService();

    await assert.rejects(
      () => service.execute('   ', {}),
      (err: unknown) => err instanceof ListReviewsError,
    );
    assert.equal(calls.reviews.length, 0);
  });
});
