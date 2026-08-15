import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager, UpdateResult } from 'typeorm';

import {
  FlashcardReviewService,
  FlashcardReviewError,
  FlashcardReviewErrorCode,
} from './flashcard-review.service';
import type {
  FlashcardsRepositoryPort,
  FlashcardReviewsRepositoryPort,
  DailyReviewStatsRepositoryPort,
  DecksRepositoryPort,
  StudySessionsRepositoryPort,
  FlashcardReviewServiceDeps,
} from './flashcard-review.service';
import { SimpleSchedulingStrategy } from './scheduling/simple-scheduling.strategy';
import type { SchedulingStrategy } from './scheduling/scheduling.types';

import {
  FlashcardStatus,
  FlashcardType,
  ReviewRating,
  StudySessionStatus,
  StudySessionType,
} from '../../models/enums';
import type { Flashcard } from '../../models/Flashcard';
import type { Deck } from '../../models/Deck';
import type { StudySession } from '../../models/StudySession';
import type { DailyReviewStat } from '../../models/DailyReviewStat';
import type { FlashcardReview } from '../../models/FlashcardReview';
import type { AnswerFlashcardInput } from '../../interfaces/flashcards/flashcard-review.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const FLASHCARD_ID = 'card-1';
const DECK_ID = 'deck-1';
const IDEMPOTENCY_KEY = 'idem-1';
const LOCAL_DATE = '2026-01-01';
const REVIEWED_AT = new Date('2026-01-01T10:00:00.000Z');
const DAY_STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const DAY_ENDED_AT = new Date('2026-01-02T00:00:00.000Z');

function makeInput(overrides: Partial<AnswerFlashcardInput> = {}): AnswerFlashcardInput {
  return {
    userId: USER_ID,
    studySessionId: SESSION_ID,
    flashcardId: FLASHCARD_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    rating: ReviewRating.GOOD,
    reviewedAt: REVIEWED_AT,
    localDate: LOCAL_DATE,
    dayStartedAt: DAY_STARTED_AT,
    dayEndedAt: DAY_ENDED_AT,
    ...overrides,
  };
}

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: FLASHCARD_ID,
    user_id: USER_ID,
    deck_id: DECK_ID,
    type: FlashcardType.VOCABULARY,
    front: 'take off',
    back: 'despegar',
    translation: null,
    example: null,
    personal_example: null,
    notes: null,
    source_name: null,
    source_url: null,
    level: null,
    tags: [],
    status: FlashcardStatus.REVIEW,
    next_review_at: new Date('2025-12-31T00:00:00.000Z'),
    interval_minutes: 1440,
    ease_factor: '2.50',
    repetitions: 3,
    lapses: 0,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    deleted_at: null,
    ...overrides,
  } as Flashcard;
}

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: DECK_ID,
    user_id: USER_ID,
    name: 'Phrasal verbs',
    description: null,
    color: null,
    is_archived: false,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    deleted_at: null,
    ...overrides,
  } as Deck;
}

function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    planned_activity_id: null,
    session_type: StudySessionType.FLASHCARD_REVIEW,
    status: StudySessionStatus.ACTIVE,
    started_at: new Date('2026-01-01T09:55:00.000Z'),
    ended_at: null,
    duration_minutes: null,
    notes: null,
    created_at: new Date('2026-01-01T09:55:00.000Z'),
    updated_at: new Date('2026-01-01T09:55:00.000Z'),
    ...overrides,
  } as StudySession;
}

function makeDailyStat(overrides: Partial<DailyReviewStat> = {}): DailyReviewStat {
  return {
    id: 'stat-1',
    user_id: USER_ID,
    local_date: LOCAL_DATE,
    timezone: 'America/Lima',
    daily_goal: 10,
    cards_due_at_first_session: 5,
    required_reviews: 5,
    cards_reviewed: 0,
    unique_cards_reviewed: 0,
    minutes_studied: 0,
    goal_completed: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as DailyReviewStat;
}

function makeReview(overrides: Partial<FlashcardReview> = {}): FlashcardReview {
  return {
    id: 'existing-review-1',
    user_id: USER_ID,
    flashcard_id: FLASHCARD_ID,
    study_session_id: SESSION_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    rating: ReviewRating.GOOD,
    previous_status: FlashcardStatus.REVIEW,
    new_status: FlashcardStatus.REVIEW,
    previous_next_review_at: new Date('2025-12-31T00:00:00.000Z'),
    new_next_review_at: new Date('2026-01-11T00:00:00.000Z'),
    previous_interval_minutes: 1440,
    new_interval_minutes: 14400,
    previous_ease_factor: '2.50',
    new_ease_factor: '2.50',
    previous_repetitions: 3,
    new_repetitions: 4,
    previous_lapses: 0,
    new_lapses: 0,
    response_time_ms: null,
    reviewed_at: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides,
  } as FlashcardReview;
}

const OK_RESULT: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
const NO_MATCH_RESULT: UpdateResult = { affected: 0, raw: [], generatedMaps: [] };

interface World {
  flashcard: Flashcard | null;
  deck: Deck | null;
  session: StudySession | null;
  dailyStat: DailyReviewStat | null;
  reviews: FlashcardReview[];
}

function createWorld(overrides: Partial<World> = {}): World {
  return {
    flashcard: makeFlashcard(),
    deck: makeDeck(),
    session: makeSession(),
    dailyStat: makeDailyStat(),
    reviews: [],
    ...overrides,
  };
}

type RepositorySource = DataSource | EntityManager;

interface Recorder {
  sources: RepositorySource[];
}

let reviewIdCounter = 0;

type MethodOverrides = Partial<
  FlashcardsRepositoryPort &
    FlashcardReviewsRepositoryPort &
    DailyReviewStatsRepositoryPort &
    DecksRepositoryPort &
    StudySessionsRepositoryPort
>;

function buildDeps(
  world: World,
  recorder: Recorder,
  overrides: MethodOverrides = {},
): FlashcardReviewServiceDeps {
  return {
    flashcards: (source) => {
      recorder.sources.push(source);
      const port: FlashcardsRepositoryPort = {
        findByIdForUpdate: async (flashcardId, userId) => {
          if (world.flashcard === null) return null;
          if (world.flashcard.id !== flashcardId || world.flashcard.user_id !== userId) return null;
          if (world.flashcard.deleted_at !== null) return null;
          return world.flashcard;
        },
        updateSchedulingState: async (flashcardId, userId, data) => {
          if (
            world.flashcard === null ||
            world.flashcard.id !== flashcardId ||
            world.flashcard.user_id !== userId ||
            world.flashcard.deleted_at !== null
          ) {
            return NO_MATCH_RESULT;
          }
          world.flashcard = {
            ...world.flashcard,
            status: data.status,
            next_review_at: data.next_review_at,
            interval_minutes: data.interval_minutes,
            ease_factor: String(data.ease_factor),
            repetitions: data.repetitions,
            lapses: data.lapses,
          };
          return OK_RESULT;
        },
      };
      return {
        ...port,
        ...(overrides.findByIdForUpdate && { findByIdForUpdate: overrides.findByIdForUpdate }),
        ...(overrides.updateSchedulingState && {
          updateSchedulingState: overrides.updateSchedulingState,
        }),
      };
    },
    flashcardReviews: (source) => {
      recorder.sources.push(source);
      const port: FlashcardReviewsRepositoryPort = {
        findByIdempotencyKey: async (userId, idempotencyKey) =>
          world.reviews.find((r) => r.user_id === userId && r.idempotency_key === idempotencyKey) ??
          null,
        existsForFlashcardOnDate: async (userId, flashcardId, dayStartedAt, dayEndedAt) =>
          world.reviews.some(
            (r) =>
              r.user_id === userId &&
              r.flashcard_id === flashcardId &&
              r.reviewed_at.getTime() >= dayStartedAt.getTime() &&
              r.reviewed_at.getTime() < dayEndedAt.getTime(),
          ),
        createReview: async (data) => {
          reviewIdCounter += 1;
          const review = {
            id: `review-${reviewIdCounter}`,
            user_id: data.userId,
            flashcard_id: data.flashcardId,
            study_session_id: data.studySessionId,
            idempotency_key: data.idempotencyKey,
            rating: data.rating,
            previous_status: data.previousStatus,
            new_status: data.newStatus,
            previous_next_review_at: data.previousNextReviewAt,
            new_next_review_at: data.newNextReviewAt,
            previous_interval_minutes: data.previousIntervalMinutes,
            new_interval_minutes: data.newIntervalMinutes,
            previous_ease_factor: String(data.previousEaseFactor),
            new_ease_factor: String(data.newEaseFactor),
            previous_repetitions: data.previousRepetitions,
            new_repetitions: data.newRepetitions,
            previous_lapses: data.previousLapses,
            new_lapses: data.newLapses,
            response_time_ms: data.responseTimeMs,
            reviewed_at: data.reviewedAt,
          } as FlashcardReview;
          world.reviews.push(review);
          return review;
        },
        countBySession: async (studySessionId, userId) =>
          world.reviews.filter((r) => r.study_session_id === studySessionId && r.user_id === userId)
            .length,
      };
      return {
        ...port,
        ...(overrides.findByIdempotencyKey && {
          findByIdempotencyKey: overrides.findByIdempotencyKey,
        }),
        ...(overrides.existsForFlashcardOnDate && {
          existsForFlashcardOnDate: overrides.existsForFlashcardOnDate,
        }),
        ...(overrides.createReview && { createReview: overrides.createReview }),
        ...(overrides.countBySession && { countBySession: overrides.countBySession }),
      };
    },
    dailyReviewStats: (source) => {
      recorder.sources.push(source);
      const port: DailyReviewStatsRepositoryPort = {
        findByUserAndDate: async (userId, localDate) => {
          if (world.dailyStat === null) return null;
          if (world.dailyStat.user_id !== userId || world.dailyStat.local_date !== localDate) {
            return null;
          }
          return world.dailyStat;
        },
        incrementCounters: async (userId, localDate, delta) => {
          if (
            world.dailyStat === null ||
            world.dailyStat.user_id !== userId ||
            world.dailyStat.local_date !== localDate
          ) {
            return NO_MATCH_RESULT;
          }
          world.dailyStat = {
            ...world.dailyStat,
            cards_reviewed: world.dailyStat.cards_reviewed + delta.cardsReviewed,
            unique_cards_reviewed:
              world.dailyStat.unique_cards_reviewed + delta.uniqueCardsReviewed,
            minutes_studied: world.dailyStat.minutes_studied + delta.minutesStudied,
          };
          return OK_RESULT;
        },
        markGoalCompleted: async (userId, localDate) => {
          if (
            world.dailyStat === null ||
            world.dailyStat.user_id !== userId ||
            world.dailyStat.local_date !== localDate
          ) {
            return NO_MATCH_RESULT;
          }
          world.dailyStat = { ...world.dailyStat, goal_completed: true };
          return OK_RESULT;
        },
      };
      return {
        ...port,
        ...(overrides.findByUserAndDate && { findByUserAndDate: overrides.findByUserAndDate }),
        ...(overrides.incrementCounters && { incrementCounters: overrides.incrementCounters }),
        ...(overrides.markGoalCompleted && { markGoalCompleted: overrides.markGoalCompleted }),
      };
    },
    decks: (source) => {
      recorder.sources.push(source);
      const port: DecksRepositoryPort = {
        findActiveByIdAndUser: async (deckId, userId) => {
          if (world.deck === null) return null;
          if (world.deck.id !== deckId || world.deck.user_id !== userId) return null;
          if (world.deck.deleted_at !== null) return null;
          return world.deck;
        },
      };
      return {
        ...port,
        ...(overrides.findActiveByIdAndUser && {
          findActiveByIdAndUser: overrides.findActiveByIdAndUser,
        }),
      };
    },
    studySessions: (source) => {
      recorder.sources.push(source);
      const port: StudySessionsRepositoryPort = {
        findByIdAndUser: async (studySessionId, userId) => {
          if (world.session === null) return null;
          if (world.session.id !== studySessionId || world.session.user_id !== userId) return null;
          return world.session;
        },
        updateSessionProgress: async (studySessionId, userId, data) => {
          if (
            world.session === null ||
            world.session.id !== studySessionId ||
            world.session.user_id !== userId
          ) {
            return NO_MATCH_RESULT;
          }
          world.session = { ...world.session, ...data };
          return OK_RESULT;
        },
      };
      return {
        ...port,
        ...(overrides.findByIdAndUser && { findByIdAndUser: overrides.findByIdAndUser }),
        ...(overrides.updateSessionProgress && {
          updateSessionProgress: overrides.updateSessionProgress,
        }),
      };
    },
  };
}

/** DataSource falso: simula rollback real restaurando el snapshot del mundo si `fn` lanza. */
function buildFakeDataSource(world: World): {
  dataSource: DataSource;
  managerMarker: EntityManager;
} {
  const managerMarker = { __marker: 'fake-entity-manager' } as unknown as EntityManager;
  const dataSource = {
    transaction: async <T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(world);
      try {
        return await fn(managerMarker);
      } catch (error) {
        Object.assign(world, snapshot);
        throw error;
      }
    },
  } as unknown as DataSource;
  return { dataSource, managerMarker };
}

class CountingSchedulingStrategy implements SchedulingStrategy {
  calls = 0;
  private readonly delegate = new SimpleSchedulingStrategy();

  calculate: SchedulingStrategy['calculate'] = (currentState, rating, reviewedAt) => {
    this.calls += 1;
    return this.delegate.calculate(currentState, rating, reviewedAt);
  };
}

function setup(overrides: MethodOverrides = {}) {
  const world = createWorld();
  const recorder: Recorder = { sources: [] };
  const deps = buildDeps(world, recorder, overrides);
  const { dataSource, managerMarker } = buildFakeDataSource(world);
  const schedulingStrategy = new CountingSchedulingStrategy();
  const service = new FlashcardReviewService(dataSource, schedulingStrategy, deps);
  return { world, recorder, dataSource, managerMarker, schedulingStrategy, service };
}

// ── Flujo exitoso ────────────────────────────────────────────────────────────────

describe('FlashcardReviewService.answerCard — success path', () => {
  it('GOOD updates the flashcard, creates a review, and increments daily stats', async () => {
    const { world, service } = setup();

    const result = await service.answerCard(makeInput({ rating: ReviewRating.GOOD }));

    assert.equal(result.idempotentReplay, false);
    assert.equal(world.flashcard?.status, FlashcardStatus.REVIEW);
    assert.equal(world.reviews.length, 1);
    assert.equal(world.dailyStat?.cards_reviewed, 1);
    assert.equal(world.dailyStat?.unique_cards_reviewed, 1);
    assert.equal(result.dailyProgress.cardsReviewed, 1);
    assert.equal(result.dailyProgress.uniqueCardsReviewed, 1);
  });

  it('AGAIN increments lapses and resets repetitions', async () => {
    const { world, service } = setup();

    const result = await service.answerCard(makeInput({ rating: ReviewRating.AGAIN }));

    assert.equal(result.scheduling.newStatus, FlashcardStatus.LEARNING);
    assert.equal(result.scheduling.newLapses, 1);
    assert.equal(result.scheduling.newRepetitions, 0);
    assert.equal(world.flashcard?.lapses, 1);
    assert.equal(world.flashcard?.repetitions, 0);
  });

  it('the review stores every previous/new value correctly', async () => {
    const { world, service } = setup();

    await service.answerCard(makeInput({ rating: ReviewRating.GOOD, responseTimeMs: 2500 }));

    const [review] = world.reviews;
    assert.equal(review.previous_status, FlashcardStatus.REVIEW);
    assert.equal(review.new_status, FlashcardStatus.REVIEW);
    assert.equal(review.previous_interval_minutes, 1440);
    // GOOD desde review: max(piso de 2 días = 2880, round(1440*2.5)=3600) = 3600
    assert.equal(review.new_interval_minutes, 3600);
    assert.equal(review.previous_ease_factor, '2.5');
    assert.equal(review.new_ease_factor, '2.5');
    assert.equal(review.previous_repetitions, 3);
    assert.equal(review.new_repetitions, 4);
    assert.equal(review.previous_lapses, 0);
    assert.equal(review.new_lapses, 0);
    assert.equal(review.response_time_ms, 2500);
    assert.equal(review.reviewed_at.getTime(), REVIEWED_AT.getTime());
    assert.deepEqual(review.previous_next_review_at, new Date('2025-12-31T00:00:00.000Z'));
  });

  it('all repositories are constructed with the exact same EntityManager', async () => {
    const { recorder, managerMarker, service } = setup();

    await service.answerCard(makeInput());

    assert.ok(recorder.sources.length >= 5);
    assert.ok(recorder.sources.every((source) => source === managerMarker));
  });
});

// ── Idempotencia ─────────────────────────────────────────────────────────────────

describe('FlashcardReviewService.answerCard — idempotency', () => {
  it('an existing idempotency key does not run the scheduler nor touch any data', async () => {
    const world = createWorld({
      reviews: [makeReview()],
    });
    const recorder: Recorder = { sources: [] };
    const deps = buildDeps(world, recorder);
    const { dataSource } = buildFakeDataSource(world);
    const schedulingStrategy = new CountingSchedulingStrategy();
    const service = new FlashcardReviewService(dataSource, schedulingStrategy, deps);

    const flashcardSnapshot = { ...world.flashcard };
    const statSnapshot = { ...world.dailyStat };

    const result = await service.answerCard(makeInput());

    assert.equal(result.idempotentReplay, true);
    assert.equal(result.reviewId, 'existing-review-1');
    assert.equal(schedulingStrategy.calls, 0);
    assert.deepEqual(world.flashcard, flashcardSnapshot);
    assert.deepEqual(world.dailyStat, statSnapshot);
    assert.equal(world.reviews.length, 1);
  });

  it('two calls with the same key return the same review id', async () => {
    const { service } = setup();
    const input = makeInput();

    const first = await service.answerCard(input);
    const second = await service.answerCard(input);

    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.reviewId, first.reviewId);
  });

  it('a new idempotency key returns idempotentReplay = false', async () => {
    const { service } = setup();

    const result = await service.answerCard(makeInput({ idempotencyKey: 'brand-new-key' }));

    assert.equal(result.idempotentReplay, false);
  });

  it('recovers from a genuine race (constraint violation) without leaving partial writes', async () => {
    const world = createWorld();
    const raceReview = makeReview({ id: 'review-from-other-request' });
    let idempotencyLookupCalls = 0;

    const recorder: Recorder = { sources: [] };
    const deps = buildDeps(world, recorder, {
      findByIdempotencyKey: async () => {
        idempotencyLookupCalls += 1;
        return idempotencyLookupCalls === 1 ? null : raceReview;
      },
      createReview: async () => {
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'uq_flashcard_reviews_idempotency';
        throw error;
      },
    });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(dataSource, new SimpleSchedulingStrategy(), deps);

    const flashcardSnapshot = { ...world.flashcard };
    const statSnapshot = { ...world.dailyStat };

    const result = await service.answerCard(makeInput());

    assert.equal(result.idempotentReplay, true);
    assert.equal(result.reviewId, 'review-from-other-request');
    assert.equal(idempotencyLookupCalls, 2);
    // No partial effects from our own failed attempt survive.
    assert.deepEqual(world.flashcard, flashcardSnapshot);
    assert.deepEqual(world.dailyStat, statSnapshot);
  });

  it('does not treat an unrelated database error as an idempotent replay', async () => {
    const { world, service } = setup({
      createReview: async () => {
        const error = new Error('connection terminated') as Error & { code: string };
        error.code = '57P01';
        throw error;
      },
    });

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, '57P01');
        return true;
      },
    );
    assert.equal(world.reviews.length, 0);
  });
});

// ── Errores y rollback ─────────────────────────────────────────────────────────────

describe('FlashcardReviewService.answerCard — errors and rollback', () => {
  it('rejects when the study session does not exist', async () => {
    const { service } = setup({ findByIdAndUser: async () => null });

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.SESSION_NOT_FOUND,
    );
  });

  it('rejects when the study session is completed (not active)', async () => {
    const world = createWorld({ session: makeSession({ status: StudySessionStatus.COMPLETED }) });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.SESSION_NOT_ACTIVE,
    );
  });

  it('rejects when the daily review stat does not exist, without touching anything', async () => {
    const world = createWorld({ dailyStat: null });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.DAILY_STAT_NOT_FOUND,
    );
    assert.equal(world.reviews.length, 0);
  });

  it('rejects when the flashcard does not exist', async () => {
    const { service } = setup({ findByIdForUpdate: async () => null });

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('rejects a suspended flashcard', async () => {
    const world = createWorld({ flashcard: makeFlashcard({ status: FlashcardStatus.SUSPENDED }) });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.FLASHCARD_SUSPENDED,
    );
  });

  it('rejects when the deck is archived', async () => {
    const world = createWorld({ deck: makeDeck({ is_archived: true }) });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.DECK_UNAVAILABLE,
    );
  });

  it('rejects when the deck no longer exists (deleted)', async () => {
    const world = createWorld({ deck: null });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.DECK_UNAVAILABLE,
    );
  });

  it('rejects an invalid stored ease factor', async () => {
    const world = createWorld({
      flashcard: makeFlashcard({ ease_factor: 'not-a-number' }),
    });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.INVALID_EASE_FACTOR,
    );
  });

  it('rolls back everything when the flashcard update affects 0 rows', async () => {
    const { world, service } = setup({ updateSchedulingState: async () => NO_MATCH_RESULT });

    await assert.rejects(
      () => service.answerCard(makeInput()),
      (error: unknown) =>
        error instanceof FlashcardReviewError &&
        error.code === FlashcardReviewErrorCode.CONCURRENT_UPDATE_CONFLICT,
    );

    // The review insert happened earlier in the same failed transaction attempt —
    // it must not survive the rollback.
    assert.equal(world.reviews.length, 0);
    assert.equal(world.dailyStat?.cards_reviewed, 0);
  });

  it('rolls back the review and scheduling update when the daily stat update fails', async () => {
    const { world, service } = setup({
      incrementCounters: async () => {
        throw new Error('connection lost mid-transaction');
      },
    });

    await assert.rejects(() => service.answerCard(makeInput()));

    assert.equal(world.reviews.length, 0);
    assert.equal(world.flashcard?.status, FlashcardStatus.REVIEW);
    assert.equal(world.flashcard?.repetitions, 3);
  });

  it('runs no further steps after an early failure (session not found)', async () => {
    let createReviewCalls = 0;
    const { service } = setup({
      findByIdAndUser: async () => null,
      createReview: async () => {
        createReviewCalls += 1;
        throw new Error('should never be called');
      },
    });

    await assert.rejects(() => service.answerCard(makeInput()));
    assert.equal(createReviewCalls, 0);
  });
});

// ── Progreso diario ────────────────────────────────────────────────────────────────

describe('FlashcardReviewService.answerCard — daily progress', () => {
  it('the first review of a card that day increments both counters', async () => {
    const { world, service } = setup();

    const result = await service.answerCard(makeInput());

    assert.equal(result.dailyProgress.cardsReviewed, 1);
    assert.equal(result.dailyProgress.uniqueCardsReviewed, 1);
    assert.equal(world.dailyStat?.cards_reviewed, 1);
    assert.equal(world.dailyStat?.unique_cards_reviewed, 1);
  });

  it('reviewing the same card again the same day increments cardsReviewed but not uniqueCardsReviewed', async () => {
    const { world, service } = setup();

    await service.answerCard(makeInput({ idempotencyKey: 'key-1', rating: ReviewRating.AGAIN }));
    const second = await service.answerCard(
      makeInput({
        idempotencyKey: 'key-2',
        rating: ReviewRating.GOOD,
        reviewedAt: new Date('2026-01-01T11:00:00.000Z'),
      }),
    );

    assert.equal(second.dailyProgress.cardsReviewed, 2);
    assert.equal(second.dailyProgress.uniqueCardsReviewed, 1);
    assert.equal(world.dailyStat?.cards_reviewed, 2);
    assert.equal(world.dailyStat?.unique_cards_reviewed, 1);
  });

  it('marks the goal completed once uniqueCardsReviewed reaches requiredReviews', async () => {
    const world = createWorld({ dailyStat: makeDailyStat({ required_reviews: 1 }) });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    const result = await service.answerCard(makeInput());

    assert.equal(result.dailyProgress.goalCompleted, true);
    assert.equal(world.dailyStat?.goal_completed, true);
  });

  it('does not re-mark the goal once it is already completed', async () => {
    const world = createWorld({
      dailyStat: makeDailyStat({ required_reviews: 1, goal_completed: true }),
    });
    let markGoalCompletedCalls = 0;
    const deps = buildDeps(
      world,
      { sources: [] },
      {
        markGoalCompleted: async () => {
          markGoalCompletedCalls += 1;
          return OK_RESULT;
        },
      },
    );
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(dataSource, new SimpleSchedulingStrategy(), deps);

    const result = await service.answerCard(makeInput());

    assert.equal(result.dailyProgress.goalCompleted, true);
    assert.equal(markGoalCompletedCalls, 0);
  });

  it('a required_reviews of 0 still needs at least 1 unique review to complete the goal', async () => {
    const world = createWorld({ dailyStat: makeDailyStat({ required_reviews: 0 }) });
    const { dataSource } = buildFakeDataSource(world);
    const service = new FlashcardReviewService(
      dataSource,
      new SimpleSchedulingStrategy(),
      buildDeps(world, { sources: [] }),
    );

    const result = await service.answerCard(makeInput());

    assert.equal(result.dailyProgress.goalCompleted, true);
  });
});
