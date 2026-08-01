import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager, UpdateResult } from 'typeorm';

import {
  CompleteFlashcardReviewSessionService,
  CompleteFlashcardReviewSessionError,
  CompleteFlashcardReviewSessionErrorCode,
} from './complete-flashcard-review-session.service';
import type {
  StudySessionsRepositoryPort,
  FlashcardReviewsRepositoryPort,
  CompleteFlashcardReviewSessionServiceDeps,
} from './complete-flashcard-review-session.service';

import {
  StudySessionStatus,
  StudySessionType,
  ReviewRating,
  FlashcardStatus,
} from '../models/enums';
import type { StudySession } from '../models/StudySession';
import type { FlashcardReview } from '../models/FlashcardReview';
import type { CompleteFlashcardReviewSessionInput } from '../interfaces/complete-flashcard-review-session.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const STARTED_AT = new Date('2026-01-15T10:00:00.000Z');

function makeInput(
  overrides: Partial<CompleteFlashcardReviewSessionInput> = {},
): CompleteFlashcardReviewSessionInput {
  return {
    userId: USER_ID,
    studySessionId: SESSION_ID,
    completedAt: new Date('2026-01-15T10:10:00.000Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    planned_activity_id: null,
    session_type: StudySessionType.FLASHCARD_REVIEW,
    status: StudySessionStatus.ACTIVE,
    started_at: STARTED_AT,
    ended_at: null,
    duration_minutes: null,
    notes: null,
    created_at: STARTED_AT,
    updated_at: STARTED_AT,
    ...overrides,
  } as StudySession;
}

let reviewIdCounter = 0;

function makeReview(overrides: Partial<FlashcardReview> = {}): FlashcardReview {
  reviewIdCounter += 1;
  return {
    id: `review-${reviewIdCounter}`,
    user_id: USER_ID,
    flashcard_id: 'card-1',
    study_session_id: SESSION_ID,
    idempotency_key: `idem-${reviewIdCounter}`,
    rating: ReviewRating.GOOD,
    previous_status: FlashcardStatus.REVIEW,
    new_status: FlashcardStatus.REVIEW,
    previous_next_review_at: new Date('2026-01-14T00:00:00.000Z'),
    new_next_review_at: new Date('2026-01-20T00:00:00.000Z'),
    previous_interval_minutes: 1440,
    new_interval_minutes: 8640,
    previous_ease_factor: '2.50',
    new_ease_factor: '2.50',
    previous_repetitions: 3,
    new_repetitions: 4,
    previous_lapses: 0,
    new_lapses: 0,
    response_time_ms: null,
    reviewed_at: new Date('2026-01-15T10:05:00.000Z'),
    ...overrides,
  } as FlashcardReview;
}

interface World {
  session: StudySession | null;
  reviews: FlashcardReview[];
}

function createWorld(overrides: Partial<World> = {}): World {
  return {
    session: makeSession(),
    reviews: [],
    ...overrides,
  };
}

type RepositorySource = DataSource | EntityManager;

interface Recorder {
  sources: RepositorySource[];
  markCompletedCalls: number;
}

const OK_RESULT: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
const NO_MATCH_RESULT: UpdateResult = { affected: 0, raw: [], generatedMaps: [] };

type MethodOverrides = Partial<StudySessionsRepositoryPort & FlashcardReviewsRepositoryPort>;

function buildDeps(
  world: World,
  recorder: Recorder,
  overrides: MethodOverrides = {},
): CompleteFlashcardReviewSessionServiceDeps {
  return {
    studySessions: (source) => {
      recorder.sources.push(source);
      const port: StudySessionsRepositoryPort = {
        findFlashcardSessionByIdForUpdate: async (studySessionId, userId) => {
          if (world.session === null) return null;
          if (world.session.id !== studySessionId || world.session.user_id !== userId) return null;
          if (world.session.session_type !== StudySessionType.FLASHCARD_REVIEW) return null;
          return world.session;
        },
        markCompleted: async (studySessionId, userId, endedAt, durationMinutes) => {
          recorder.markCompletedCalls += 1;
          if (
            world.session === null ||
            world.session.id !== studySessionId ||
            world.session.user_id !== userId ||
            world.session.session_type !== StudySessionType.FLASHCARD_REVIEW ||
            world.session.status !== StudySessionStatus.ACTIVE
          ) {
            return NO_MATCH_RESULT;
          }
          world.session = {
            ...world.session,
            status: StudySessionStatus.COMPLETED,
            ended_at: endedAt,
            duration_minutes: durationMinutes,
          };
          return OK_RESULT;
        },
      };
      return {
        ...port,
        ...(overrides.findFlashcardSessionByIdForUpdate && {
          findFlashcardSessionByIdForUpdate: overrides.findFlashcardSessionByIdForUpdate,
        }),
        ...(overrides.markCompleted && { markCompleted: overrides.markCompleted }),
      };
    },
    flashcardReviews: (source) => {
      recorder.sources.push(source);
      const port: FlashcardReviewsRepositoryPort = {
        countBySession: async (studySessionId, userId) =>
          world.reviews.filter((r) => r.study_session_id === studySessionId && r.user_id === userId)
            .length,
        findLatestBySession: async (studySessionId, userId) => {
          const matches = world.reviews.filter(
            (r) => r.study_session_id === studySessionId && r.user_id === userId,
          );
          if (matches.length === 0) return null;
          return matches.reduce((latest, current) =>
            current.reviewed_at.getTime() > latest.reviewed_at.getTime() ? current : latest,
          );
        },
      };
      return {
        ...port,
        ...(overrides.countBySession && { countBySession: overrides.countBySession }),
        ...(overrides.findLatestBySession && {
          findLatestBySession: overrides.findLatestBySession,
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

function setup(worldOverrides: Partial<World> = {}, methodOverrides: MethodOverrides = {}) {
  const world = createWorld(worldOverrides);
  const recorder: Recorder = { sources: [], markCompletedCalls: 0 };
  const deps = buildDeps(world, recorder, methodOverrides);
  const { dataSource, managerMarker } = buildFakeDataSource(world);
  const service = new CompleteFlashcardReviewSessionService(dataSource, deps);
  return { world, recorder, dataSource, managerMarker, service };
}

// ── Flujo exitoso ────────────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — success path', () => {
  it('completes an active session, storing completedAt and status', async () => {
    const { world, service } = setup();

    const result = await service.execute(makeInput());

    assert.equal(result.idempotentReplay, false);
    assert.equal(result.session.status, StudySessionStatus.COMPLETED);
    assert.equal(result.session.endedAt.getTime(), new Date('2026-01-15T10:10:00.000Z').getTime());
    assert.equal(world.session?.status, StudySessionStatus.COMPLETED);
    assert.equal(
      world.session?.ended_at?.getTime(),
      new Date('2026-01-15T10:10:00.000Z').getTime(),
    );
  });

  it('returns the number of reviews recorded in the session', async () => {
    const { service } = setup({ reviews: [makeReview(), makeReview(), makeReview()] });

    const result = await service.execute(makeInput());

    assert.equal(result.summary.reviewsCount, 3);
  });

  it('all repositories are constructed with the exact same EntityManager', async () => {
    const { recorder, managerMarker, service } = setup();

    await service.execute(makeInput());

    assert.ok(recorder.sources.length >= 2);
    assert.ok(recorder.sources.every((source) => source === managerMarker));
  });
});

// ── Duración ─────────────────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — duration calculation', () => {
  it('a session shorter than a minute produces 0', async () => {
    const { service } = setup();

    const result = await service.execute(
      makeInput({ completedAt: new Date(STARTED_AT.getTime() + 30_000) }),
    );

    assert.equal(result.session.durationMinutes, 0);
  });

  it('a 90-second session produces 1', async () => {
    const { service } = setup();

    const result = await service.execute(
      makeInput({ completedAt: new Date(STARTED_AT.getTime() + 90_000) }),
    );

    assert.equal(result.session.durationMinutes, 1);
  });

  it('an exact 10-minute session produces 10', async () => {
    const { service } = setup();

    const result = await service.execute(
      makeInput({ completedAt: new Date(STARTED_AT.getTime() + 10 * 60_000) }),
    );

    assert.equal(result.session.durationMinutes, 10);
  });

  it('never reduces a provisional duration_minutes that is already higher', async () => {
    const { service } = setup({ session: makeSession({ duration_minutes: 45 }) });

    const result = await service.execute(
      makeInput({ completedAt: new Date(STARTED_AT.getTime() + 5 * 60_000) }),
    );

    assert.equal(result.session.durationMinutes, 45);
  });

  it('does not rely on the real clock — driven entirely by input.completedAt', async () => {
    const { service } = setup();

    const result = await service.execute(
      makeInput({ completedAt: new Date(STARTED_AT.getTime() + 3 * 60_000) }),
    );

    assert.equal(result.session.durationMinutes, 3);
  });
});

// ── Idempotencia ─────────────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — idempotency', () => {
  it('an already-completed session does not call markCompleted again', async () => {
    const { recorder, service } = setup({
      session: makeSession({
        status: StudySessionStatus.COMPLETED,
        ended_at: new Date('2026-01-15T10:10:00.000Z'),
        duration_minutes: 10,
      }),
    });

    const result = await service.execute(
      makeInput({ completedAt: new Date('2026-01-15T11:00:00.000Z') }),
    );

    assert.equal(recorder.markCompletedCalls, 0);
    assert.equal(result.idempotentReplay, true);
  });

  it('returns the persisted ended_at, not the new completedAt', async () => {
    const persistedEndedAt = new Date('2026-01-15T10:10:00.000Z');
    const { service } = setup({
      session: makeSession({
        status: StudySessionStatus.COMPLETED,
        ended_at: persistedEndedAt,
        duration_minutes: 10,
      }),
    });

    const result = await service.execute(
      makeInput({ completedAt: new Date('2026-01-15T12:00:00.000Z') }),
    );

    assert.equal(result.session.endedAt.getTime(), persistedEndedAt.getTime());
  });

  it('returns the persisted duration', async () => {
    const { service } = setup({
      session: makeSession({
        status: StudySessionStatus.COMPLETED,
        ended_at: new Date('2026-01-15T10:10:00.000Z'),
        duration_minutes: 37,
      }),
    });

    const result = await service.execute(makeInput());

    assert.equal(result.session.durationMinutes, 37);
  });

  it('two sequential completions produce a single update', async () => {
    const { recorder, service } = setup();

    const first = await service.execute(makeInput());
    const second = await service.execute(
      makeInput({ completedAt: new Date('2026-01-15T12:00:00.000Z') }),
    );

    assert.equal(recorder.markCompletedCalls, 1);
    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.session.endedAt.getTime(), first.session.endedAt.getTime());
  });

  it('rejects a completed session with no ended_at as a persistence inconsistency', async () => {
    const { service } = setup({
      session: makeSession({ status: StudySessionStatus.COMPLETED, ended_at: null }),
    });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.PERSISTENCE_INCONSISTENCY,
    );
  });
});

// ── Validaciones ─────────────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — validations', () => {
  it('rejects an empty userId', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ userId: '' })),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  });

  it('rejects an empty studySessionId', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ studySessionId: '  ' })),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  });

  it('rejects an invalid completedAt', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ completedAt: new Date('not-a-date') })),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  });

  it('rejects when the session does not exist', async () => {
    const { service } = setup({ session: null });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND,
    );
  });

  it('treats an activity-type session as not found', async () => {
    const { service } = setup({
      session: makeSession({ session_type: StudySessionType.ACTIVITY }),
    });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND,
    );
  });

  it('treats another user session as not found (no ownership leak)', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ userId: 'someone-else' })),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND,
    );
  });

  it('rejects a session with an invalid status (defensive: neither active nor completed)', async () => {
    const { service } = setup({
      session: { ...makeSession(), status: 'weird_status' as StudySessionStatus },
    });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.INVALID_SESSION_STATUS,
    );
  });

  it('rejects an active session with no started_at', async () => {
    const { service } = setup({ session: makeSession({ started_at: null }) });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.SESSION_START_TIME_MISSING,
    );
  });

  it('rejects completedAt before started_at', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ completedAt: new Date(STARTED_AT.getTime() - 1000) })),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_SESSION_START,
    );
  });

  it('rejects completedAt before the latest recorded review', async () => {
    const latestReview = makeReview({ reviewed_at: new Date('2026-01-15T10:30:00.000Z') });
    const { service } = setup({ reviews: [latestReview] });

    await assert.rejects(
      () => service.execute(makeInput({ completedAt: new Date('2026-01-15T10:20:00.000Z') })),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_LAST_REVIEW,
    );
  });
});

// ── Rollback y conflictos ─────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — rollback and conflicts', () => {
  it('affected === 0 raises SESSION_COMPLETION_CONFLICT and rolls back', async () => {
    const { world, service } = setup({}, { markCompleted: async () => NO_MATCH_RESULT });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof CompleteFlashcardReviewSessionError &&
        error.code === CompleteFlashcardReviewSessionErrorCode.SESSION_COMPLETION_CONFLICT,
    );
    assert.equal(world.session?.status, StudySessionStatus.ACTIVE);
  });

  it('an error counting reviews reverts the completion attempt', async () => {
    const { world, service } = setup(
      {},
      {
        countBySession: async () => {
          throw new Error('connection lost mid-transaction');
        },
      },
    );

    await assert.rejects(() => service.execute(makeInput()));

    assert.equal(world.session?.status, StudySessionStatus.ACTIVE);
    assert.equal(world.session?.ended_at, null);
  });

  it('an error updating the session leaves no partial changes', async () => {
    const { world, service } = setup(
      {},
      {
        markCompleted: async () => {
          throw new Error('connection lost mid-transaction');
        },
      },
    );

    await assert.rejects(() => service.execute(makeInput()));

    assert.equal(world.session?.status, StudySessionStatus.ACTIVE);
    assert.equal(world.session?.duration_minutes, null);
  });

  it('runs no further steps after an early failure (session not found)', async () => {
    let countCalls = 0;
    const { service } = setup(
      { session: null },
      {
        countBySession: async () => {
          countCalls += 1;
          return 0;
        },
      },
    );

    await assert.rejects(() => service.execute(makeInput()));
    assert.equal(countCalls, 0);
  });
});

// ── Sesión vacía ─────────────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — empty session', () => {
  it('closes successfully with zero reviews', async () => {
    const { service } = setup({ reviews: [] });

    const result = await service.execute(makeInput());

    assert.equal(result.summary.reviewsCount, 0);
    assert.equal(result.idempotentReplay, false);
  });
});

// ── Concurrencia ─────────────────────────────────────────────────────────────────

describe('CompleteFlashcardReviewSessionService — concurrency', () => {
  it('a second concurrent close observes the completed session and does not re-update it', async () => {
    // Simulates Request A having already committed by the time Request B
    // acquires the row lock: the pessimistic lock in the real repository
    // serializes this: B only proceeds once A's transaction is done.
    const world = createWorld({
      session: makeSession({
        status: StudySessionStatus.COMPLETED,
        ended_at: new Date('2026-01-15T10:10:00.000Z'),
        duration_minutes: 10,
      }),
    });
    const recorder: Recorder = { sources: [], markCompletedCalls: 0 };
    const deps = buildDeps(world, recorder);
    const { dataSource } = buildFakeDataSource(world);
    const service = new CompleteFlashcardReviewSessionService(dataSource, deps);

    const result = await service.execute(
      makeInput({ completedAt: new Date('2026-01-15T11:00:00.000Z') }),
    );

    assert.equal(recorder.markCompletedCalls, 0);
    assert.equal(result.idempotentReplay, true);
    assert.equal(result.session.endedAt.getTime(), new Date('2026-01-15T10:10:00.000Z').getTime());
  });
});
