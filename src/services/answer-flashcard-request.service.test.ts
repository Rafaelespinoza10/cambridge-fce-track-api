import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import { AnswerFlashcardRequestService } from './answer-flashcard-request.service';
import type {
  UsersRepositoryPort,
  FlashcardReviewServicePort,
  AnswerFlashcardRequestServiceDeps,
} from './answer-flashcard-request.service';
import {
  StartFlashcardReviewSessionError,
  StartFlashcardReviewSessionErrorCode,
} from './start-flashcard-review-session.service';

import { ReviewRating, FlashcardStatus } from '../models/enums';
import type { User } from '../models/User';
import type { UserProfile } from '../models/UserProfile';
import type { AnswerFlashcardRequestInput } from '../interfaces/answer-flashcard-request.interface';
import type { AnswerFlashcardResult } from '../interfaces/flashcard-review.interface';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const FLASHCARD_ID = 'card-1';
const IDEMPOTENCY_KEY = 'idem-1';
const REVIEWED_AT = new Date('2026-01-15T14:30:00.000Z');

function makeInput(
  overrides: Partial<AnswerFlashcardRequestInput> = {},
): AnswerFlashcardRequestInput {
  return {
    userId: USER_ID,
    studySessionId: SESSION_ID,
    flashcardId: FLASHCARD_ID,
    rating: ReviewRating.GOOD,
    idempotencyKey: IDEMPOTENCY_KEY,
    reviewedAt: REVIEWED_AT,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    user_id: USER_ID,
    current_level: null,
    target_exam: null,
    target_score: null,
    target_date: null,
    study_days_per_week: null,
    daily_study_minutes: null,
    timezone: 'UTC',
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  } as UserProfile;
}

function makeUser(profile: UserProfile | null = makeProfile()): User {
  return { id: USER_ID, profile } as unknown as User;
}

const ANSWER_RESULT: AnswerFlashcardResult = {
  reviewId: 'review-1',
  idempotentReplay: false,
  scheduling: {
    previousStatus: FlashcardStatus.REVIEW,
    newStatus: FlashcardStatus.REVIEW,
    previousNextReviewAt: new Date('2026-01-14T00:00:00.000Z'),
    newNextReviewAt: new Date('2026-01-20T00:00:00.000Z'),
    previousIntervalMinutes: 1440,
    newIntervalMinutes: 8640,
    previousEaseFactor: 2.5,
    newEaseFactor: 2.5,
    previousRepetitions: 3,
    newRepetitions: 4,
    previousLapses: 0,
    newLapses: 0,
  },
  dailyProgress: {
    cardsReviewed: 1,
    uniqueCardsReviewed: 1,
    requiredReviews: 5,
    goalCompleted: false,
  },
  sessionProgress: { reviewsCount: 1 },
};

interface Setup {
  user: User | null;
  answerCardCalls: number;
  lastAnswerCardInput: Parameters<FlashcardReviewServicePort['answerCard']>[0] | null;
  service: AnswerFlashcardRequestService;
}

function setup(
  user: User | null = makeUser(),
  answerCardOverride?: FlashcardReviewServicePort['answerCard'],
): Setup {
  const state: Setup = {
    user,
    answerCardCalls: 0,
    lastAnswerCardInput: null,
    service: null as unknown as AnswerFlashcardRequestService,
  };

  const usersRepo: UsersRepositoryPort = {
    findUserWithProfile: async (userId) =>
      state.user !== null && state.user.id === userId ? state.user : null,
  };
  const flashcardReview: FlashcardReviewServicePort = {
    answerCard: async (input) => {
      state.answerCardCalls += 1;
      state.lastAnswerCardInput = input;
      return answerCardOverride ? answerCardOverride(input) : ANSWER_RESULT;
    },
  };
  const deps: AnswerFlashcardRequestServiceDeps = {
    users: () => usersRepo,
    flashcardReview: () => flashcardReview,
  };
  const fakeDataSource = {} as DataSource;
  state.service = new AnswerFlashcardRequestService(fakeDataSource, deps);
  return state;
}

describe('AnswerFlashcardRequestService — timezone resolution', () => {
  it('resolves the timezone from the user profile', async () => {
    const state = setup(makeUser(makeProfile({ timezone: 'America/Mexico_City' })));

    await state.service.execute(makeInput());

    assert.equal(state.lastAnswerCardInput?.dayStartedAt.toISOString(), '2026-01-15T06:00:00.000Z');
    assert.equal(state.lastAnswerCardInput?.dayEndedAt.toISOString(), '2026-01-16T06:00:00.000Z');
    assert.equal(state.lastAnswerCardInput?.localDate, '2026-01-15');
  });

  it('a null profile timezone defaults to UTC', async () => {
    const state = setup(makeUser(makeProfile({ timezone: null })));

    await state.service.execute(makeInput());

    assert.equal(state.lastAnswerCardInput?.dayStartedAt.toISOString(), '2026-01-15T00:00:00.000Z');
    assert.equal(state.lastAnswerCardInput?.dayEndedAt.toISOString(), '2026-01-16T00:00:00.000Z');
  });

  it('an invalid stored timezone fails with StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE', async () => {
    const state = setup(makeUser(makeProfile({ timezone: 'Not/A_Zone' })));

    await assert.rejects(
      () => state.service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE,
    );
  });

  it('rejects when the user does not exist', async () => {
    const state = setup(null);

    await assert.rejects(
      () => state.service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND,
    );
  });

  it('rejects when the user has no profile', async () => {
    const state = setup(makeUser(null));

    await assert.rejects(
      () => state.service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.PROFILE_NOT_FOUND,
    );
  });
});

describe('AnswerFlashcardRequestService — delegation to FlashcardReviewService', () => {
  it('calls answerCard exactly once with the resolved context and forwards the result', async () => {
    const state = setup();

    const result = await state.service.execute(makeInput({ responseTimeMs: 2500 }));

    assert.equal(state.answerCardCalls, 1);
    assert.equal(result, ANSWER_RESULT);
    assert.equal(state.lastAnswerCardInput?.userId, USER_ID);
    assert.equal(state.lastAnswerCardInput?.studySessionId, SESSION_ID);
    assert.equal(state.lastAnswerCardInput?.flashcardId, FLASHCARD_ID);
    assert.equal(state.lastAnswerCardInput?.idempotencyKey, IDEMPOTENCY_KEY);
    assert.equal(state.lastAnswerCardInput?.rating, ReviewRating.GOOD);
    assert.equal(state.lastAnswerCardInput?.reviewedAt.getTime(), REVIEWED_AT.getTime());
    assert.equal(state.lastAnswerCardInput?.responseTimeMs, 2500);
  });

  it('propagates an error thrown by answerCard unchanged', async () => {
    const state = setup(makeUser(), async () => {
      throw new Error('some FlashcardReviewService domain error');
    });

    await assert.rejects(
      () => state.service.execute(makeInput()),
      /some FlashcardReviewService domain error/,
    );
  });
});
