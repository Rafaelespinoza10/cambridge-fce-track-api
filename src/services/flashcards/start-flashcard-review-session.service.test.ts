import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager } from 'typeorm';

import {
  StartFlashcardReviewSessionService,
  StartFlashcardReviewSessionError,
  StartFlashcardReviewSessionErrorCode,
} from './start-flashcard-review-session.service';
import type {
  UsersRepositoryPort,
  FlashcardPreferencesRepositoryPort,
  StudySessionsRepositoryPort,
  DailyReviewStatsRepositoryPort,
  DecksRepositoryPort,
  FlashcardsRepositoryPort,
  StartFlashcardReviewSessionServiceDeps,
} from './start-flashcard-review-session.service';

import {
  FlashcardStatus,
  FlashcardType,
  StudySessionStatus,
  StudySessionType,
} from '../../models/enums';
import type { User } from '../../models/User';
import type { UserProfile } from '../../models/UserProfile';
import type { Deck } from '../../models/Deck';
import type { Flashcard } from '../../models/Flashcard';
import type { StudySession } from '../../models/StudySession';
import type { DailyReviewStat } from '../../models/DailyReviewStat';
import type { FlashcardPreference } from '../../models/FlashcardPreference';
import type { StartFlashcardReviewSessionInput } from '../../interfaces/flashcards/start-flashcard-review-session.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const DECK_ID = 'deck-1';
const SESSION_ID = 'session-1';
const REQUESTED_AT = new Date('2026-01-15T14:30:00.000Z');

function makeInput(
  overrides: Partial<StartFlashcardReviewSessionInput> = {},
): StartFlashcardReviewSessionInput {
  return {
    userId: USER_ID,
    requestedAt: REQUESTED_AT,
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

function makeUser(
  overrides: Partial<User> = {},
  profile: UserProfile | null = makeProfile(),
): User {
  return {
    id: USER_ID,
    email: 'user@example.com',
    password_hash: null,
    first_name: null,
    last_name: null,
    role: 'student',
    is_active: true,
    email_verified_at: null,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    deleted_at: null,
    profile,
    ...overrides,
  } as unknown as User;
}

function makePreference(overrides: Partial<FlashcardPreference> = {}): FlashcardPreference {
  return {
    id: 'pref-1',
    user_id: USER_ID,
    daily_goal: 10,
    created_at: new Date('2025-01-01T00:00:00.000Z'),
    updated_at: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  } as FlashcardPreference;
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

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-1',
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
    next_review_at: new Date('2026-01-14T00:00:00.000Z'),
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

function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    planned_activity_id: null,
    session_type: StudySessionType.FLASHCARD_REVIEW,
    status: StudySessionStatus.ACTIVE,
    started_at: new Date('2026-01-15T14:00:00.000Z'),
    ended_at: null,
    duration_minutes: null,
    notes: null,
    created_at: new Date('2026-01-15T14:00:00.000Z'),
    updated_at: new Date('2026-01-15T14:00:00.000Z'),
    ...overrides,
  } as StudySession;
}

function makeDailyStat(overrides: Partial<DailyReviewStat> = {}): DailyReviewStat {
  return {
    id: 'stat-1',
    user_id: USER_ID,
    local_date: '2026-01-15',
    timezone: 'UTC',
    daily_goal: 10,
    cards_due_at_first_session: 3,
    required_reviews: 3,
    cards_reviewed: 0,
    unique_cards_reviewed: 0,
    minutes_studied: 0,
    goal_completed: false,
    created_at: new Date('2026-01-15T00:00:00.000Z'),
    updated_at: new Date('2026-01-15T00:00:00.000Z'),
    ...overrides,
  } as DailyReviewStat;
}

interface World {
  user: User | null;
  preference: FlashcardPreference | null;
  deck: Deck | null;
  session: StudySession | null;
  dailyStat: DailyReviewStat | null;
  dueFlashcards: Flashcard[];
}

function createWorld(overrides: Partial<World> = {}): World {
  return {
    user: makeUser(),
    preference: null,
    deck: makeDeck(),
    session: null,
    dailyStat: null,
    dueFlashcards: [makeFlashcard()],
    ...overrides,
  };
}

type RepositorySource = DataSource | EntityManager;

interface Recorder {
  sources: RepositorySource[];
  sessionCreations: number;
  dailyStatCreations: number;
}

type MethodOverrides = Partial<
  UsersRepositoryPort &
    FlashcardPreferencesRepositoryPort &
    StudySessionsRepositoryPort &
    DailyReviewStatsRepositoryPort &
    DecksRepositoryPort &
    FlashcardsRepositoryPort
>;

function buildDeps(
  world: World,
  recorder: Recorder,
  overrides: MethodOverrides = {},
): StartFlashcardReviewSessionServiceDeps {
  return {
    users: (source) => {
      recorder.sources.push(source);
      const port: UsersRepositoryPort = {
        findUserWithProfile: async (userId) => {
          if (world.user === null || world.user.id !== userId) return null;
          return world.user;
        },
      };
      return {
        ...port,
        ...(overrides.findUserWithProfile && {
          findUserWithProfile: overrides.findUserWithProfile,
        }),
      };
    },
    flashcardPreferences: (source) => {
      recorder.sources.push(source);
      const port: FlashcardPreferencesRepositoryPort = {
        getOrCreate: async (userId) => {
          if (world.preference !== null && world.preference.user_id === userId) {
            return world.preference;
          }
          world.preference = makePreference({ user_id: userId });
          return world.preference;
        },
      };
      return {
        ...port,
        ...(overrides.getOrCreate && { getOrCreate: overrides.getOrCreate }),
      };
    },
    studySessions: (source) => {
      recorder.sources.push(source);
      const port: StudySessionsRepositoryPort = {
        findActiveFlashcardSessionByUser: async (userId) => {
          if (world.session === null || world.session.user_id !== userId) return null;
          if (world.session.status !== StudySessionStatus.ACTIVE) return null;
          return world.session;
        },
        createFlashcardSession: async (userId, startedAt) => {
          recorder.sessionCreations += 1;
          world.session = makeSession({ user_id: userId, started_at: startedAt });
          return world.session;
        },
      };
      return {
        ...port,
        ...(overrides.findActiveFlashcardSessionByUser && {
          findActiveFlashcardSessionByUser: overrides.findActiveFlashcardSessionByUser,
        }),
        ...(overrides.createFlashcardSession && {
          createFlashcardSession: overrides.createFlashcardSession,
        }),
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
        createDailyStat: async (data) => {
          recorder.dailyStatCreations += 1;
          world.dailyStat = makeDailyStat({
            user_id: data.userId,
            local_date: data.localDate,
            timezone: data.timezone,
            daily_goal: data.dailyGoal,
            cards_due_at_first_session: data.cardsDueAtFirstSession,
            required_reviews: data.requiredReviews,
          });
        },
      };
      return {
        ...port,
        ...(overrides.findByUserAndDate && { findByUserAndDate: overrides.findByUserAndDate }),
        ...(overrides.createDailyStat && { createDailyStat: overrides.createDailyStat }),
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
    flashcards: (source) => {
      recorder.sources.push(source);
      const port: FlashcardsRepositoryPort = {
        findDueByUser: async (userId, _asOf, options = {}) =>
          world.dueFlashcards.filter(
            (f) =>
              f.user_id === userId &&
              (options.deckId === undefined || f.deck_id === options.deckId),
          ),
        countDueByUser: async (userId) =>
          world.dueFlashcards.filter((f) => f.user_id === userId).length,
      };
      return {
        ...port,
        ...(overrides.findDueByUser && { findDueByUser: overrides.findDueByUser }),
        ...(overrides.countDueByUser && { countDueByUser: overrides.countDueByUser }),
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
  const recorder: Recorder = { sources: [], sessionCreations: 0, dailyStatCreations: 0 };
  const deps = buildDeps(world, recorder, methodOverrides);
  const { dataSource, managerMarker } = buildFakeDataSource(world);
  const service = new StartFlashcardReviewSessionService(dataSource, deps);
  return { world, recorder, dataSource, managerMarker, service };
}

// ── Resolución de timezone y día local ──────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — timezone resolution', () => {
  it('defaults to UTC when the profile has no timezone set', async () => {
    const { world, service } = setup({ user: makeUser({}, makeProfile({ timezone: null })) });

    const result = await service.execute(makeInput());

    assert.equal(result.timezone, 'UTC');
    assert.equal(result.localDate, '2026-01-15');
    assert.equal(world.dailyStat?.timezone, 'UTC');
  });

  it('uses the profile timezone and resolves the correct local day', async () => {
    const { service } = setup({
      user: makeUser({}, makeProfile({ timezone: 'America/Mexico_City' })),
    });

    // 2026-01-15T14:30:00Z is 2026-01-15T08:30 in Mexico City (UTC-6).
    const result = await service.execute(makeInput());

    assert.equal(result.timezone, 'America/Mexico_City');
    assert.equal(result.localDate, '2026-01-15');
    assert.equal(result.dayStartedAt.toISOString(), '2026-01-15T06:00:00.000Z');
    assert.equal(result.dayEndedAt.toISOString(), '2026-01-16T06:00:00.000Z');
  });

  it('rejects an invalid IANA timezone stored in the profile', async () => {
    const { service } = setup({
      user: makeUser({}, makeProfile({ timezone: 'Not/A_Zone' })),
    });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE,
    );
  });

  it('rejects when the user does not exist', async () => {
    const { service } = setup({ user: null });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND,
    );
  });

  it('rejects when the user has no profile', async () => {
    const { service } = setup({ user: makeUser({}, null) });

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.PROFILE_NOT_FOUND,
    );
  });
});

// ── Preferencias ─────────────────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — preferences', () => {
  it('creates default preferences when none exist yet', async () => {
    const { service } = setup({ preference: null });

    const result = await service.execute(makeInput());

    assert.equal(result.dailyGoal, 10);
  });

  it('reuses existing preferences instead of creating new ones', async () => {
    const { world, service } = setup({ preference: makePreference({ daily_goal: 25 }) });

    const result = await service.execute(makeInput());

    assert.equal(result.dailyGoal, 25);
    assert.equal(world.preference?.daily_goal, 25);
  });
});

// ── Sesión activa y carreras ─────────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — active session handling', () => {
  it('creates a new session when none is active, using requestedAt as started_at', async () => {
    const { world, recorder, service } = setup({ session: null });

    const result = await service.execute(makeInput());

    assert.equal(result.sessionResumed, false);
    assert.equal(recorder.sessionCreations, 1);
    assert.equal(world.session?.started_at?.getTime(), REQUESTED_AT.getTime());
    assert.equal(result.sessionStartedAt.getTime(), REQUESTED_AT.getTime());
  });

  it('resumes an existing active session without touching started_at', async () => {
    const existingStartedAt = new Date('2026-01-15T09:00:00.000Z');
    const { recorder, service } = setup({
      session: makeSession({ started_at: existingStartedAt }),
    });

    const result = await service.execute(makeInput());

    assert.equal(result.sessionResumed, true);
    assert.equal(recorder.sessionCreations, 0);
    assert.equal(result.sessionStartedAt.getTime(), existingStartedAt.getTime());
    assert.equal(result.studySessionId, SESSION_ID);
  });

  it('retries once and resumes the winning session after a creation race', async () => {
    // The fake transaction rolls back any mutation made during a failed attempt
    // (it restores the pre-attempt snapshot), so a session "created" inside the
    // doomed attempt cannot be the thing the retry observes — exactly like real
    // Postgres, where THIS transaction's writes vanish on rollback. What survives
    // is the concurrent winner's already-committed row, modeled here as
    // findActiveFlashcardSessionByUser returning it starting on the 2nd call.
    let createCalls = 0;
    let findActiveCalls = 0;
    const winningSession = makeSession({ started_at: new Date('2026-01-15T14:29:00.000Z') });
    const world = createWorld({ session: null });
    const recorder: Recorder = { sources: [], sessionCreations: 0, dailyStatCreations: 0 };
    const deps = buildDeps(world, recorder, {
      findActiveFlashcardSessionByUser: async () => {
        findActiveCalls += 1;
        return findActiveCalls === 1 ? null : winningSession;
      },
      createFlashcardSession: async () => {
        createCalls += 1;
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'uq_study_sessions_one_active_flashcard_review';
        throw error;
      },
    });
    const { dataSource } = buildFakeDataSource(world);
    const service = new StartFlashcardReviewSessionService(dataSource, deps);

    const result = await service.execute(makeInput());

    assert.equal(createCalls, 1);
    assert.equal(findActiveCalls, 2);
    assert.equal(result.sessionResumed, true);
    assert.equal(result.studySessionId, SESSION_ID);
  });

  it('surfaces a domain error if the race persists past the single retry', async () => {
    const world = createWorld({ session: null });
    const recorder: Recorder = { sources: [], sessionCreations: 0, dailyStatCreations: 0 };
    const deps = buildDeps(world, recorder, {
      createFlashcardSession: async () => {
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
          constraint: string;
        };
        error.code = '23505';
        error.constraint = 'uq_study_sessions_one_active_flashcard_review';
        throw error;
      },
      findActiveFlashcardSessionByUser: async () => null,
    });
    const { dataSource } = buildFakeDataSource(world);
    const service = new StartFlashcardReviewSessionService(dataSource, deps);

    await assert.rejects(
      () => service.execute(makeInput()),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.SESSION_RACE_UNRESOLVED,
    );
  });
});

// ── DailyReviewStat y snapshots ──────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — DailyReviewStat handling', () => {
  it('creates a fresh DailyReviewStat with cardsDueAtFirstSession and requiredReviews = min(goal, due)', async () => {
    const { world, recorder, service } = setup({
      preference: makePreference({ daily_goal: 2 }),
      dueFlashcards: [
        makeFlashcard(),
        makeFlashcard({ id: 'card-2' }),
        makeFlashcard({ id: 'card-3' }),
      ],
    });

    const result = await service.execute(makeInput());

    assert.equal(recorder.dailyStatCreations, 1);
    assert.equal(result.dailyProgress.cardsDueAtFirstSession, 3);
    assert.equal(result.dailyProgress.requiredReviews, 2);
    assert.equal(world.dailyStat?.required_reviews, 2);
  });

  it('required_reviews cannot exceed the number of cards actually due', async () => {
    const { service } = setup({
      preference: makePreference({ daily_goal: 50 }),
      dueFlashcards: [makeFlashcard()],
    });

    const result = await service.execute(makeInput());

    assert.equal(result.dailyProgress.cardsDueAtFirstSession, 1);
    assert.equal(result.dailyProgress.requiredReviews, 1);
  });

  it('reuses an existing DailyReviewStat snapshot instead of recomputing it', async () => {
    const existingStat = makeDailyStat({
      cards_due_at_first_session: 99,
      required_reviews: 7,
      cards_reviewed: 4,
    });
    const { world, recorder, service } = setup({ dailyStat: existingStat });

    const result = await service.execute(makeInput());

    assert.equal(recorder.dailyStatCreations, 0);
    assert.equal(result.dailyProgress.cardsDueAtFirstSession, 99);
    assert.equal(result.dailyProgress.requiredReviews, 7);
    assert.equal(result.dailyProgress.cardsReviewed, 4);
    assert.equal(world.dailyStat, existingStat);
  });

  it('cardsDueAtFirstSession ignores the deckId filter (account-wide snapshot)', async () => {
    const { service } = setup({
      preference: makePreference({ daily_goal: 10 }),
      dueFlashcards: [
        makeFlashcard({ id: 'card-1', deck_id: DECK_ID }),
        makeFlashcard({ id: 'card-2', deck_id: 'other-deck' }),
      ],
    });

    const result = await service.execute(makeInput({ deckId: DECK_ID }));

    // Global due count is 2, even though the queue below is filtered to 1.
    assert.equal(result.dailyProgress.cardsDueAtFirstSession, 2);
    assert.equal(result.queue.cardsDue, 1);
  });
});

// ── Cola de tarjetas pendientes ──────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — pending queue', () => {
  it('returns the full due queue when no deckId filter is given', async () => {
    const { service } = setup({
      dueFlashcards: [
        makeFlashcard({ id: 'card-1', deck_id: DECK_ID }),
        makeFlashcard({ id: 'card-2', deck_id: 'other-deck' }),
      ],
    });

    const result = await service.execute(makeInput());

    assert.equal(result.queue.cardsDue, 2);
    assert.equal(result.queue.cards.length, 2);
  });

  it('filters the queue by deckId when provided', async () => {
    const { service } = setup({
      dueFlashcards: [
        makeFlashcard({ id: 'card-1', deck_id: DECK_ID }),
        makeFlashcard({ id: 'card-2', deck_id: 'other-deck' }),
      ],
    });

    const result = await service.execute(makeInput({ deckId: DECK_ID }));

    assert.equal(result.queue.cardsDue, 1);
    assert.equal(result.queue.cards[0].id, 'card-1');
  });

  it('maps flashcards to plain queue DTOs (no raw entity leaks)', async () => {
    const { service } = setup({ dueFlashcards: [makeFlashcard({ front: 'give up' })] });

    const result = await service.execute(makeInput());

    const [item] = result.queue.cards;
    assert.deepEqual(Object.keys(item).sort(), [
      'back',
      'deckId',
      'example',
      'front',
      'id',
      'level',
      'nextReviewAt',
      'notes',
      'personalExample',
      'status',
      'tags',
      'translation',
      'type',
    ]);
    assert.equal(item.front, 'give up');
  });

  it('a zero-pending-cards queue is a valid state, not an error', async () => {
    const { service } = setup({ dueFlashcards: [] });

    const result = await service.execute(makeInput());

    assert.equal(result.queue.cardsDue, 0);
    assert.deepEqual(result.queue.cards, []);
  });
});

// ── Validación de mazo ───────────────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — deck validation', () => {
  it('rejects a deckId that does not exist or belongs to another user', async () => {
    const { service } = setup({ deck: null });

    await assert.rejects(
      () => service.execute(makeInput({ deckId: DECK_ID })),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.DECK_UNAVAILABLE,
    );
  });

  it('rejects an archived deck', async () => {
    const { service } = setup({ deck: makeDeck({ is_archived: true }) });

    await assert.rejects(
      () => service.execute(makeInput({ deckId: DECK_ID })),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.DECK_UNAVAILABLE,
    );
  });
});

// ── Validación de input ──────────────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — input validation', () => {
  it('rejects a missing userId', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ userId: '' })),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  });

  it('rejects an invalid requestedAt', async () => {
    const { service } = setup();

    await assert.rejects(
      () => service.execute(makeInput({ requestedAt: new Date('not-a-date') })),
      (error: unknown) =>
        error instanceof StartFlashcardReviewSessionError &&
        error.code === StartFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  });
});

// ── Atomicidad / rollback ────────────────────────────────────────────────────────────

describe('StartFlashcardReviewSessionService — atomicity', () => {
  it('rolls back the newly created session if the DailyReviewStat creation blows up', async () => {
    const { world, service } = setup(
      { session: null, dailyStat: null },
      {
        createDailyStat: async () => {
          throw new Error('connection lost mid-transaction');
        },
      },
    );

    await assert.rejects(() => service.execute(makeInput()));

    assert.equal(world.session, null);
  });

  it('all repositories are constructed with the exact same EntityManager', async () => {
    const { recorder, managerMarker, service } = setup();

    await service.execute(makeInput());

    assert.ok(recorder.sources.length >= 5);
    assert.ok(recorder.sources.every((source) => source === managerMarker));
  });
});
