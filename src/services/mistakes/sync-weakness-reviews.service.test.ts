import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';

import { SyncWeaknessReviewsService } from './sync-weakness-reviews.service';
import type {
  SyncGradedItem,
  SyncWeaknessReviewsInput,
  WeaknessReviewsRepositoryPort,
} from './sync-weakness-reviews.service';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';
import type { WeaknessReview } from '../../models/WeaknessReview';
import {
  MistakeErrorType,
  MistakeErrorSubtype,
  WeaknessReviewStatus,
  WeaknessReviewResult,
} from '../../models/enums';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import { RetestResult } from '@lib/mistakes/retest-scheduler';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const EXERCISE_ID = 'exercise-1';
const REVIEW_ID = 'review-1';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function profile(overrides: Partial<WeaknessDto> = {}): WeaknessDto {
  return {
    skill: 'use-of-english',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    masteryScore: 58,
    status: MasteryStatus.LEARNING,
    timesWrong: 4,
    conceptCount: 2,
    remediationAttempts: 6,
    remediationCorrect: 4,
    distinctBaseWords: 2,
    distinctPracticeDays: 2,
    firstSeenAt: new Date(NOW.getTime() - 30 * MS_PER_DAY),
    lastWrongAt: new Date(NOW.getTime() - 10 * MS_PER_DAY),
    lastPracticedAt: NOW,
    masteredBlocked: false,
    ...overrides,
  };
}

function review(overrides: Partial<WeaknessReview> = {}): WeaknessReview {
  return {
    id: REVIEW_ID,
    user_id: USER_ID,
    skill_slug: 'use-of-english',
    exam_code: 'B2_FIRST',
    paper_code: 'PAPER_1',
    part_code: 'UOE_PART_3',
    error_type: MistakeErrorType.WORD_CLASS,
    error_subtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    status: WeaknessReviewStatus.SCHEDULED,
    due_at: new Date(NOW.getTime() - MS_PER_DAY),
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

function retestItem(family: string, isCorrect: boolean, reviewId = REVIEW_ID): SyncGradedItem {
  return {
    metadata: {
      generationSource: 'spaced_retest',
      practiceMode: 'pattern_transfer',
      targetConceptId: 'concept-1',
      targetErrorType: MistakeErrorType.WORD_CLASS,
      targetErrorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
      itemBaseWord: family,
      scheduledReviewId: reviewId,
    },
    isCorrect,
    normalizedAnswer: `${family.toLowerCase()}ly`,
  };
}

interface Calls {
  upserts: Array<Record<string, unknown>>;
  completes: Array<Record<string, unknown>>;
  cancels: Array<Record<string, unknown>>;
}

function makeService(
  options: {
    profiles?: WeaknessDto[];
    scheduled?: WeaknessReview[];
    byId?: WeaknessReview | null;
    completeReturns?: boolean;
  } = {},
): { service: SyncWeaknessReviewsService; calls: Calls } {
  const calls: Calls = { upserts: [], completes: [], cancels: [] };
  const reviews: WeaknessReviewsRepositoryPort = {
    async upsertScheduled(data) {
      calls.upserts.push(data as unknown as Record<string, unknown>);
    },
    async findScheduledForUser() {
      return options.scheduled ?? [];
    },
    async findByIdForUser(_userId, id) {
      if (options.byId === undefined) return review({ id });
      return options.byId;
    },
    async complete(data) {
      calls.completes.push(data as unknown as Record<string, unknown>);
      return options.completeReturns ?? true;
    },
    async cancelScheduled(userId, identity) {
      calls.cancels.push({ userId, ...identity });
    },
  };

  const service = new SyncWeaknessReviewsService({
    reviews: () => reviews,
    weaknessProfiles: async () => options.profiles ?? [profile()],
  });
  return { service, calls };
}

function input(overrides: Partial<SyncWeaknessReviewsInput> = {}): SyncWeaknessReviewsInput {
  return {
    userId: USER_ID,
    attemptId: ATTEMPT_ID,
    exerciseId: EXERCISE_ID,
    partCode: 'UOE_PART_3',
    generationMetadata: { generationSource: 'mistake_practice' },
    items: [],
    submittedAt: NOW,
    ...overrides,
  };
}

const MANAGER = {} as EntityManager;

describe('SyncWeaknessReviewsService — what it ignores', () => {
  it('does nothing at all for an ordinary practice submission', async () => {
    const { service, calls } = makeService();

    const outcomes = await service.sync(MANAGER, input({ generationMetadata: null }));

    assert.deepEqual(outcomes, []);
    assert.equal(calls.upserts.length, 0);
    assert.equal(calls.completes.length, 0);
    assert.equal(calls.cancels.length, 0);
  });

  it('does nothing for a generated exercise that is not from the Mistake Bank', async () => {
    const { service, calls } = makeService();

    await service.sync(MANAGER, input({ generationMetadata: { provider: 'openai' } }));

    assert.equal(calls.upserts.length, 0);
  });
});

describe('SyncWeaknessReviewsService — first-time scheduling', () => {
  it('schedules a newly eligible pattern at the interval its status earns', async () => {
    const { service, calls } = makeService({ profiles: [profile()], scheduled: [] });

    await service.sync(MANAGER, input());

    assert.equal(calls.upserts.length, 1);
    const [upsert] = calls.upserts;
    assert.equal(upsert.intervalDays, 3); // LEARNING
    assert.equal(upsert.consecutiveSuccessfulReviews, 0);
    assert.equal(upsert.masteryScoreBefore, 58);
    assert.equal(upsert.userId, USER_ID);
  });

  it('gives a STRONG pattern a longer first interval than a LEARNING one', async () => {
    const { service, calls } = makeService({
      profiles: [profile({ masteryScore: 78, status: MasteryStatus.STRONG })],
      scheduled: [],
    });

    await service.sync(MANAGER, input());

    assert.equal(calls.upserts[0].intervalDays, 7);
  });

  it('anchors the due date on the last practice, so a stale pattern is born overdue', async () => {
    const lastPracticedAt = new Date(NOW.getTime() - 10 * MS_PER_DAY);
    const { service, calls } = makeService({
      profiles: [profile({ lastPracticedAt })],
      scheduled: [],
    });

    await service.sync(MANAGER, input());

    const dueAt = calls.upserts[0].dueAt as Date;
    assert.equal(dueAt.getTime(), lastPracticedAt.getTime() + 3 * MS_PER_DAY);
    assert.ok(dueAt.getTime() < NOW.getTime(), 'should already be due');
  });

  it('never schedules a WEAK pattern — it needs practice, not a retention test', async () => {
    const { service, calls } = makeService({
      profiles: [profile({ masteryScore: 21, status: MasteryStatus.WEAK })],
      scheduled: [],
    });

    await service.sync(MANAGER, input());

    assert.equal(calls.upserts.length, 0);
  });

  it('never schedules a pattern with no successful remediation', async () => {
    const { service, calls } = makeService({
      profiles: [profile({ masteryScore: 88, remediationCorrect: 0 })],
      scheduled: [],
    });

    await service.sync(MANAGER, input());

    assert.equal(calls.upserts.length, 0);
  });

  it('keeps scheduling a MASTERED pattern — mastered is not permanent', async () => {
    const { service, calls } = makeService({
      profiles: [profile({ masteryScore: 91, status: MasteryStatus.MASTERED })],
      scheduled: [],
    });

    await service.sync(MANAGER, input());

    assert.equal(calls.upserts[0].intervalDays, 14);
  });
});

describe('SyncWeaknessReviewsService — voluntary practice', () => {
  it('leaves an existing scheduled review untouched, so practice cannot postpone a retest', async () => {
    const { service, calls } = makeService({ profiles: [profile()], scheduled: [review()] });

    await service.sync(MANAGER, input());

    assert.equal(calls.upserts.length, 0);
    assert.equal(calls.cancels.length, 0);
  });

  it('retires the review of a pattern that regressed out of eligibility', async () => {
    const { service, calls } = makeService({
      profiles: [profile({ masteryScore: 18, status: MasteryStatus.WEAK })],
      scheduled: [review()],
    });

    await service.sync(MANAGER, input());

    assert.equal(calls.cancels.length, 1);
    assert.equal(calls.cancels[0].userId, USER_ID);
    assert.equal(calls.cancels[0].partCode, 'UOE_PART_3');
  });
});

describe('SyncWeaknessReviewsService — completing a retest', () => {
  const retestInput = (items: SyncGradedItem[]): SyncWeaknessReviewsInput =>
    input({ generationMetadata: { generationSource: 'spaced_retest' }, items });

  it('passes a 3/3 retest across three word families and grows the interval', async () => {
    const { service, calls } = makeService({
      byId: review({ interval_days: 7, consecutive_successful_reviews: 1 }),
      profiles: [profile({ masteryScore: 89, status: MasteryStatus.MASTERED })],
    });

    const outcomes = await service.sync(
      MANAGER,
      retestInput([
        retestItem('CAREFUL', true),
        retestItem('PROFESSIONAL', true),
        retestItem('EFFECTIVE', true),
      ]),
    );

    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].result, RetestResult.PASS);
    assert.equal(outcomes[0].correctCount, 3);
    assert.equal(outcomes[0].distinctCorrectFamilies, 3);
    assert.equal(outcomes[0].masteryScoreBefore, 78);
    assert.equal(outcomes[0].masteryScoreAfter, 89);
    assert.equal(outcomes[0].nextIntervalDays, 14);
    assert.equal(calls.completes[0].result, WeaknessReviewResult.PASS);
    assert.equal(calls.upserts[0].intervalDays, 14);
    assert.equal(calls.upserts[0].consecutiveSuccessfulReviews, 2);
  });

  it('only partially credits a perfect retest that never left one word family', async () => {
    const { service, calls } = makeService({ byId: review({ interval_days: 7 }) });

    const outcomes = await service.sync(
      MANAGER,
      retestInput([
        retestItem('CAREFUL', true),
        retestItem('CAREFUL', true),
        retestItem('CAREFUL', true),
      ]),
    );

    assert.equal(outcomes[0].result, RetestResult.PARTIAL);
    assert.equal(outcomes[0].nextIntervalDays, 7);
    assert.equal(calls.upserts[0].consecutiveSuccessfulReviews, 0);
  });

  it('fails a 1/3 retest and brings the next check-up much closer', async () => {
    const { service, calls } = makeService({
      byId: review({ interval_days: 14, consecutive_successful_reviews: 3 }),
      profiles: [profile({ masteryScore: 68, status: MasteryStatus.LEARNING })],
    });

    const outcomes = await service.sync(
      MANAGER,
      retestInput([
        retestItem('CAREFUL', true),
        retestItem('PROFESSIONAL', false),
        retestItem('EFFECTIVE', false),
      ]),
    );

    assert.equal(outcomes[0].result, RetestResult.FAIL);
    assert.equal(outcomes[0].masteryScoreAfter, 68);
    assert.equal(outcomes[0].masteryStatusAfter, MasteryStatus.LEARNING);
    assert.equal(outcomes[0].nextIntervalDays, 3);
    assert.equal(calls.upserts[0].consecutiveSuccessfulReviews, 0);
  });

  it('retests tomorrow when the failure collapsed the pattern to WEAK', async () => {
    const { service, calls } = makeService({
      byId: review({ interval_days: 14 }),
      profiles: [profile({ masteryScore: 31, status: MasteryStatus.WEAK })],
    });

    const outcomes = await service.sync(
      MANAGER,
      retestInput([retestItem('CAREFUL', false), retestItem('PROFESSIONAL', false)]),
    );

    assert.equal(outcomes[0].nextIntervalDays, 1);
    // No longer eligible, so nothing is booked: it goes back to remediation.
    assert.equal(calls.upserts.length, 0);
  });

  it('stamps the follow-up date on the submission, not on the old due date', async () => {
    const { service } = makeService({
      byId: review({ interval_days: 3, due_at: new Date(NOW.getTime() - 5 * MS_PER_DAY) }),
      profiles: [profile({ masteryScore: 75, status: MasteryStatus.STRONG })],
    });

    const outcomes = await service.sync(
      MANAGER,
      retestInput([retestItem('CAREFUL', true), retestItem('PROFESSIONAL', true)]),
    );

    assert.equal(outcomes[0].nextReviewAt.getTime(), NOW.getTime() + 7 * MS_PER_DAY);
  });

  it('records which exercise and attempt answered the review', async () => {
    const { service, calls } = makeService({ byId: review() });

    await service.sync(MANAGER, retestInput([retestItem('CAREFUL', true)]));

    assert.equal(calls.completes[0].practiceExerciseId, EXERCISE_ID);
    assert.equal(calls.completes[0].practiceAttemptId, ATTEMPT_ID);
  });
});

describe('SyncWeaknessReviewsService — completion is idempotent and private', () => {
  const retestInput = (items: SyncGradedItem[]): SyncWeaknessReviewsInput =>
    input({ generationMetadata: { generationSource: 'spaced_retest' }, items });

  it('never re-grades a review that is already completed', async () => {
    const { service, calls } = makeService({
      byId: review({ status: WeaknessReviewStatus.COMPLETED }),
    });

    const outcomes = await service.sync(MANAGER, retestInput([retestItem('CAREFUL', true)]));

    assert.deepEqual(outcomes, []);
    assert.equal(calls.completes.length, 0);
  });

  it('books no follow-up when another submission closed the review first', async () => {
    const { service, calls } = makeService({
      byId: review(),
      completeReturns: false,
      // Whoever won the race already booked the follow-up, so the pattern
      // has an active review again.
      scheduled: [review({ id: 'review-2', interval_days: 14 })],
    });

    const outcomes = await service.sync(MANAGER, retestInput([retestItem('CAREFUL', true)]));

    assert.deepEqual(outcomes, []);
    assert.equal(calls.upserts.length, 0);
  });

  it("silently skips a review id that is not this user's", async () => {
    const { service, calls } = makeService({ byId: null });

    const outcomes = await service.sync(MANAGER, retestInput([retestItem('CAREFUL', true)]));

    assert.deepEqual(outcomes, []);
    assert.equal(calls.completes.length, 0);
  });

  it('ignores items that carry no review id', async () => {
    const { service, calls } = makeService({ scheduled: [] });

    const outcomes = await service.sync(
      MANAGER,
      input({
        generationMetadata: { generationSource: 'spaced_retest' },
        items: [{ metadata: null, isCorrect: true, normalizedAnswer: 'carefully' }],
      }),
    );

    assert.deepEqual(outcomes, []);
    assert.equal(calls.completes.length, 0);
  });

  it('falls back to the produced answer when the item carries no extracted family', async () => {
    const { service } = makeService({ byId: review() });

    const outcomes = await service.sync(
      MANAGER,
      input({
        generationMetadata: { generationSource: 'spaced_retest' },
        items: [
          {
            metadata: { scheduledReviewId: REVIEW_ID, itemBaseWord: null },
            isCorrect: true,
            normalizedAnswer: 'carefully',
          },
          {
            metadata: { scheduledReviewId: REVIEW_ID, itemBaseWord: null },
            isCorrect: true,
            normalizedAnswer: 'professionally',
          },
        ],
      }),
    );

    assert.equal(outcomes[0].distinctCorrectFamilies, 2);
    assert.equal(outcomes[0].result, RetestResult.PASS);
  });
});
