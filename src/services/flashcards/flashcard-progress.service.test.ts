import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, UpdateResult } from 'typeorm';

import {
  FlashcardProgressService,
  FlashcardProgressError,
  FlashcardProgressErrorCode,
} from './flashcard-progress.service';
import type {
  UsersRepositoryPort,
  FlashcardPreferencesRepositoryPort,
  DailyReviewStatsRepositoryPort,
  FlashcardsRepositoryPort,
  FlashcardProgressServiceDeps,
} from './flashcard-progress.service';
import type { User } from '../../models/User';
import type { UserProfile } from '../../models/UserProfile';
import type { FlashcardPreference } from '../../models/FlashcardPreference';
import type { DailyReviewStat } from '../../models/DailyReviewStat';

const USER_ID = 'user-1';
const NOW = new Date('2026-01-15T14:30:00.000Z');

const OK_RESULT: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
const NO_MATCH_RESULT: UpdateResult = { affected: 0, raw: [], generatedMaps: [] };

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

function makeDailyStat(overrides: Partial<DailyReviewStat> = {}): DailyReviewStat {
  return {
    id: 'stat-1',
    user_id: USER_ID,
    local_date: '2026-01-15',
    timezone: 'UTC',
    daily_goal: 10,
    cards_due_at_first_session: 8,
    required_reviews: 8,
    cards_reviewed: 3,
    unique_cards_reviewed: 3,
    minutes_studied: 5,
    goal_completed: false,
    created_at: new Date('2026-01-15T08:00:00.000Z'),
    updated_at: new Date('2026-01-15T08:00:00.000Z'),
    ...overrides,
  } as DailyReviewStat;
}

interface World {
  user: User | null;
  preferences: FlashcardPreference | null;
  dailyStats: DailyReviewStat[];
  completedDates: string[];
  cardsDueNow: number;
}

function createWorld(overrides: Partial<World> = {}): World {
  return {
    user: makeUser(),
    preferences: makePreference(),
    dailyStats: [],
    completedDates: [],
    cardsDueNow: 0,
    ...overrides,
  };
}

function buildFakeUsersRepo(world: World): UsersRepositoryPort {
  return {
    findUserWithProfile: async (userId) => (world.user?.id === userId ? world.user : null),
  };
}

function buildFakePreferencesRepo(world: World): FlashcardPreferencesRepositoryPort {
  return {
    getOrCreate: async (userId) => {
      if (world.preferences !== null && world.preferences.user_id === userId) {
        return world.preferences;
      }
      const created = makePreference({ user_id: userId });
      world.preferences = created;
      return created;
    },
    findByUser: async (userId) =>
      world.preferences !== null && world.preferences.user_id === userId ? world.preferences : null,
    updateDailyGoal: async (userId, dailyGoal) => {
      if (world.preferences === null || world.preferences.user_id !== userId)
        return NO_MATCH_RESULT;
      world.preferences = { ...world.preferences, daily_goal: dailyGoal };
      return OK_RESULT;
    },
  };
}

function buildFakeDailyReviewStatsRepo(world: World): DailyReviewStatsRepositoryPort {
  return {
    findByUserAndDate: async (userId, localDate) => {
      const found = world.dailyStats.find(
        (s) => s.user_id === userId && s.local_date === localDate,
      );
      return found ?? null;
    },
    findCompletedDates: async (userId) => (userId === USER_ID ? world.completedDates : []),
    resyncDailyGoal: async (userId, localDate, dailyGoal) => {
      const stat = world.dailyStats.find(
        (s) => s.user_id === userId && s.local_date === localDate && !s.goal_completed,
      );
      if (stat === undefined) return NO_MATCH_RESULT;
      stat.daily_goal = dailyGoal;
      stat.required_reviews = Math.min(dailyGoal, stat.cards_due_at_first_session);
      return OK_RESULT;
    },
    markGoalCompleted: async (userId, localDate) => {
      const stat = world.dailyStats.find((s) => s.user_id === userId && s.local_date === localDate);
      if (stat === undefined) return NO_MATCH_RESULT;
      stat.goal_completed = true;
      return OK_RESULT;
    },
  };
}

function buildFakeFlashcardsRepo(world: World): FlashcardsRepositoryPort {
  return {
    countDueByUser: async () => world.cardsDueNow,
  };
}

function setup(worldOverrides: Partial<World> = {}) {
  const world = createWorld(worldOverrides);
  const deps: FlashcardProgressServiceDeps = {
    users: () => buildFakeUsersRepo(world),
    flashcardPreferences: () => buildFakePreferencesRepo(world),
    dailyReviewStats: () => buildFakeDailyReviewStatsRepo(world),
    flashcards: () => buildFakeFlashcardsRepo(world),
  };
  const service = new FlashcardProgressService({} as DataSource, deps);
  return { world, service };
}

function isInvalidInput(error: unknown): boolean {
  return (
    error instanceof FlashcardProgressError &&
    error.code === FlashcardProgressErrorCode.INVALID_INPUT
  );
}

// ── Preferencias: GET ───────────────────────────────────────────────────────────

describe('FlashcardProgressService.getPreferences', () => {
  it('returns the existing preference', async () => {
    const { service } = setup({ preferences: makePreference({ daily_goal: 25 }) });
    const dto = await service.getPreferences(USER_ID);
    assert.equal(dto.dailyGoal, 25);
  });

  it('creates the default preference when none exists', async () => {
    const { world, service } = setup({ preferences: null });
    const dto = await service.getPreferences(USER_ID);
    assert.equal(dto.dailyGoal, 10);
    assert.notEqual(world.preferences, null);
  });

  it('returns only dailyGoal, no internal fields', async () => {
    const { service } = setup();
    const dto = await service.getPreferences(USER_ID);
    assert.deepEqual(Object.keys(dto), ['dailyGoal']);
  });
});

// ── Preferencias: PATCH ──────────────────────────────────────────────────────────

describe('FlashcardProgressService.updatePreferences', () => {
  it('updates a valid goal', async () => {
    const { service } = setup();
    const dto = await service.updatePreferences(USER_ID, { dailyGoal: 30 });
    assert.equal(dto.dailyGoal, 30);
  });

  it('rejects zero', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updatePreferences(USER_ID, { dailyGoal: 0 }),
      isInvalidInput,
    );
  });

  it('rejects negative numbers', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updatePreferences(USER_ID, { dailyGoal: -5 }),
      isInvalidInput,
    );
  });

  it('rejects decimals', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updatePreferences(USER_ID, { dailyGoal: 5.5 }),
      isInvalidInput,
    );
  });

  it('rejects strings', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updatePreferences(USER_ID, { dailyGoal: '20' as unknown as number }),
      isInvalidInput,
    );
  });

  it('rejects values greater than 500', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updatePreferences(USER_ID, { dailyGoal: 501 }),
      isInvalidInput,
    );
  });

  it('accepts the boundary value of 500', async () => {
    const { service } = setup();
    const dto = await service.updatePreferences(USER_ID, { dailyGoal: 500 });
    assert.equal(dto.dailyGoal, 500);
  });

  it('affected === 0 produces PREFERENCES_UPDATE_CONFLICT', async () => {
    // Simulate the row vanishing between getOrCreate and updateDailyGoal.
    const world = createWorld();
    const deps: FlashcardProgressServiceDeps = {
      users: () => buildFakeUsersRepo(world),
      flashcardPreferences: () => ({
        getOrCreate: async () => makePreference(),
        findByUser: async () => null,
        updateDailyGoal: async () => NO_MATCH_RESULT,
      }),
      dailyReviewStats: () => buildFakeDailyReviewStatsRepo(world),
      flashcards: () => buildFakeFlashcardsRepo(world),
    };
    const service = new FlashcardProgressService({} as DataSource, deps);
    await assert.rejects(
      () => service.updatePreferences(USER_ID, { dailyGoal: 20 }),
      (error: unknown) =>
        error instanceof FlashcardProgressError &&
        error.code === FlashcardProgressErrorCode.PREFERENCES_UPDATE_CONFLICT,
    );
  });

  it('retrieves and returns the updated value', async () => {
    const { world, service } = setup();
    const dto = await service.updatePreferences(USER_ID, { dailyGoal: 42 });
    assert.equal(dto.dailyGoal, 42);
    assert.equal(world.preferences?.daily_goal, 42);
  });

  it("resyncs today's DailyReviewStat so a mid-day goal change takes effect immediately", async () => {
    // cards_due_at_first_session: 8, unique_cards_reviewed: 3 (see makeDailyStat defaults).
    const todayStat = makeDailyStat({ local_date: '2026-01-15', daily_goal: 10 });
    const { world, service } = setup({ dailyStats: [todayStat] });
    await service.updatePreferences(USER_ID, { dailyGoal: 3 }, NOW);
    assert.equal(world.dailyStats[0]!.daily_goal, 3);
    assert.equal(world.dailyStats[0]!.required_reviews, 3);
  });

  it('marks the day completed immediately if lowering the goal now satisfies it', async () => {
    const todayStat = makeDailyStat({ local_date: '2026-01-15', daily_goal: 10 });
    const { world, service } = setup({ dailyStats: [todayStat] });
    await service.updatePreferences(USER_ID, { dailyGoal: 3 }, NOW);
    assert.equal(world.dailyStats[0]!.goal_completed, true);
  });

  it('caps required_reviews at cards_due_at_first_session, not the raw new goal', async () => {
    const todayStat = makeDailyStat({ local_date: '2026-01-15', daily_goal: 10 });
    const { world, service } = setup({ dailyStats: [todayStat] });
    await service.updatePreferences(USER_ID, { dailyGoal: 50 }, NOW);
    assert.equal(world.dailyStats[0]!.required_reviews, 8);
    assert.equal(world.dailyStats[0]!.goal_completed, false);
  });

  it('does not reopen a day already marked as completed', async () => {
    const todayStat = makeDailyStat({
      local_date: '2026-01-15',
      daily_goal: 10,
      goal_completed: true,
    });
    const { world, service } = setup({ dailyStats: [todayStat] });
    await service.updatePreferences(USER_ID, { dailyGoal: 3 }, NOW);
    assert.equal(world.dailyStats[0]!.daily_goal, 10);
    assert.equal(world.dailyStats[0]!.goal_completed, true);
  });

  it('leaves other days untouched', async () => {
    const yesterdayStat = makeDailyStat({ local_date: '2026-01-14', daily_goal: 10 });
    const { world, service } = setup({ dailyStats: [yesterdayStat] });
    await service.updatePreferences(USER_ID, { dailyGoal: 3 }, NOW);
    assert.equal(world.dailyStats[0]!.daily_goal, 10);
  });

  it('ignores unknown/protected fields sent by the client', async () => {
    const { service } = setup();
    const maliciousInput = {
      dailyGoal: 15,
      userId: 'someone-else',
      id: 'forged-id',
      createdAt: new Date(),
    } as unknown as { dailyGoal: number };
    const dto = await service.updatePreferences(USER_ID, maliciousInput);
    assert.deepEqual(Object.keys(dto), ['dailyGoal']);
    assert.equal(dto.dailyGoal, 15);
  });
});

// ── Resumen sin DailyReviewStat ──────────────────────────────────────────────────

describe('FlashcardProgressService.getReviewSummary — no DailyReviewStat yet', () => {
  it('marks initialized = false and does not create a daily stat', async () => {
    const { world, service } = setup({ preferences: makePreference({ daily_goal: 12 }) });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.initialized, false);
    assert.equal(world.dailyStats.length, 0);
  });

  it('uses the current preference as day.dailyGoal', async () => {
    const { service } = setup({ preferences: makePreference({ daily_goal: 17 }) });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.dailyGoal, 17);
    assert.equal(summary.preferences.dailyGoal, 17);
  });

  it('computes cardsDueNow independently', async () => {
    const { service } = setup({ cardsDueNow: 7 });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.cardsDueNow, 7);
  });

  it('returns null snapshots', async () => {
    const { service } = setup();
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.cardsDueAtFirstSession, null);
    assert.equal(summary.day.requiredReviews, null);
  });

  it('returns zeroed counters and an incomplete goal', async () => {
    const { service } = setup();
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.cardsReviewed, 0);
    assert.equal(summary.day.uniqueCardsReviewed, 0);
    assert.equal(summary.day.goalCompleted, false);
  });

  it('still computes the streak from previous days', async () => {
    const { service } = setup({ completedDates: ['2026-01-13', '2026-01-14'] });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    // NOW resolves to localDate 2026-01-15 in UTC; yesterday (01-14) is
    // completed, so the streak continues provisionally.
    assert.equal(summary.streak.current, 2);
    assert.equal(summary.streak.best, 2);
  });
});

// ── Resumen con DailyReviewStat ──────────────────────────────────────────────────

describe('FlashcardProgressService.getReviewSummary — existing DailyReviewStat', () => {
  it('marks initialized = true and returns persisted snapshots', async () => {
    const stat = makeDailyStat({
      local_date: '2026-01-15',
      daily_goal: 10,
      cards_due_at_first_session: 8,
      required_reviews: 8,
      cards_reviewed: 4,
      unique_cards_reviewed: 4,
      goal_completed: false,
    });
    const { service } = setup({ dailyStats: [stat] });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.initialized, true);
    assert.equal(summary.day.cardsDueAtFirstSession, 8);
    assert.equal(summary.day.requiredReviews, 8);
    assert.equal(summary.day.cardsReviewed, 4);
    assert.equal(summary.day.uniqueCardsReviewed, 4);
  });

  it('does not overwrite the snapshot with the current preference', async () => {
    const stat = makeDailyStat({ local_date: '2026-01-15', daily_goal: 10 });
    const { service } = setup({
      dailyStats: [stat],
      preferences: makePreference({ daily_goal: 20 }),
    });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.dailyGoal, 10);
    assert.equal(summary.preferences.dailyGoal, 20);
  });

  it('computes cardsDueNow independently of the snapshot', async () => {
    const stat = makeDailyStat({ local_date: '2026-01-15', cards_due_at_first_session: 8 });
    const { service } = setup({ dailyStats: [stat], cardsDueNow: 3 });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.cardsDueNow, 3);
    assert.equal(summary.day.cardsDueAtFirstSession, 8);
  });

  it('returns goalCompleted from the snapshot', async () => {
    const stat = makeDailyStat({ local_date: '2026-01-15', goal_completed: true });
    const { service } = setup({ dailyStats: [stat] });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.goalCompleted, true);
  });

  it('allows preferences.dailyGoal and day.dailyGoal to legitimately differ', async () => {
    const stat = makeDailyStat({ local_date: '2026-01-15', daily_goal: 10 });
    const { service } = setup({
      dailyStats: [stat],
      preferences: makePreference({ daily_goal: 99 }),
    });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.notEqual(summary.day.dailyGoal, summary.preferences.dailyGoal);
  });
});

// ── Timezone ─────────────────────────────────────────────────────────────────────

describe('FlashcardProgressService.getReviewSummary — timezone resolution', () => {
  it('defaults to UTC when the profile has no timezone set', async () => {
    const { service } = setup({ user: makeUser({}, makeProfile({ timezone: null })) });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.timezone, 'UTC');
    assert.equal(summary.day.localDate, '2026-01-15');
  });

  it('resolves America/Mexico_City correctly', async () => {
    const { service } = setup({
      user: makeUser({}, makeProfile({ timezone: 'America/Mexico_City' })),
    });
    // 2026-01-15T14:30:00Z is 2026-01-15T08:30 in Mexico City (UTC-6)
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.timezone, 'America/Mexico_City');
    assert.equal(summary.day.localDate, '2026-01-15');
  });

  it('rejects an invalid IANA timezone stored in the profile', async () => {
    const { service } = setup({ user: makeUser({}, makeProfile({ timezone: 'Not/A_Zone' })) });
    await assert.rejects(
      () => service.getReviewSummary(USER_ID, NOW),
      (error: unknown) =>
        error instanceof FlashcardProgressError &&
        error.code === FlashcardProgressErrorCode.INVALID_TIMEZONE,
    );
  });

  it('resolves the correct localDate near midnight in a negative-offset timezone', async () => {
    // 2026-01-15T04:00:00Z is 2026-01-14T22:00 in Mexico City (UTC-6) -> still the 14th locally
    const nearMidnight = new Date('2026-01-15T04:00:00.000Z');
    const { service } = setup({
      user: makeUser({}, makeProfile({ timezone: 'America/Mexico_City' })),
    });
    const summary = await service.getReviewSummary(USER_ID, nearMidnight);
    assert.equal(summary.day.localDate, '2026-01-14');
  });

  it('rejects when the user does not exist', async () => {
    const { service } = setup({ user: null });
    await assert.rejects(
      () => service.getReviewSummary(USER_ID, NOW),
      (error: unknown) =>
        error instanceof FlashcardProgressError &&
        error.code === FlashcardProgressErrorCode.USER_NOT_FOUND,
    );
  });

  it('defaults to UTC when the user has no profile', async () => {
    const { service } = setup({ user: makeUser({}, null) });
    const summary = await service.getReviewSummary(USER_ID, NOW);
    assert.equal(summary.day.timezone, 'UTC');
  });
});
