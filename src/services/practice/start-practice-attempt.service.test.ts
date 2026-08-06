import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  StartPracticeAttemptService,
  StartPracticeAttemptError,
  StartPracticeAttemptErrorCode,
} from './start-practice-attempt.service';
import type {
  PracticeExercisesRepositoryPort,
  PracticeAttemptsRepositoryPort,
} from './start-practice-attempt.service';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import { PracticeAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const EXERCISE_ID = '22222222-2222-2222-2222-222222222222';
const STARTED_AT = new Date('2026-01-01T00:00:00.000Z');

const EXERCISE = { id: EXERCISE_ID, item_count: 8 } as unknown as PracticeExercise;

const SAFE_EXERCISE: PracticeExerciseSafeWithItems = {
  exercise: {
    id: EXERCISE_ID,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    targetLevel: null,
    title: 't',
    instructions: 'i',
    stimulus: null,
    timeLimitSeconds: null,
    itemCount: 8,
    createdAt: new Date(),
  },
  items: [],
};

function makeAttempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: 'attempt-id',
    user_id: USER_ID,
    exercise_id: EXERCISE_ID,
    status: PracticeAttemptStatus.IN_PROGRESS,
    started_at: STARTED_AT,
    total_count: 8,
    ...overrides,
  } as unknown as PracticeAttempt;
}

function pgUniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

interface Overrides {
  findByIdForUser?: (exerciseId: string, userId: string) => Promise<PracticeExercise | null>;
  findActiveByUser?: (userId: string) => Promise<PracticeAttempt | null>;
  createAttempt?: PracticeAttemptsRepositoryPort['createAttempt'];
}

function makeService(overrides: Overrides = {}): { service: StartPracticeAttemptService } {
  const dataSource = {
    transaction: async <T>(work: (manager: never) => Promise<T>) => work({} as never),
  } as unknown as DataSource;

  const exercises = (): PracticeExercisesRepositoryPort => ({
    findByIdForUser: overrides.findByIdForUser ?? (async () => EXERCISE),
    findSafeExerciseWithItemsForUser: async () => SAFE_EXERCISE,
  });

  const attempts = (): PracticeAttemptsRepositoryPort => ({
    findActiveByUser: overrides.findActiveByUser ?? (async () => null),
    createAttempt:
      overrides.createAttempt ??
      (async (data) => makeAttempt({ exercise_id: data.exerciseId, total_count: data.totalCount })),
  });

  const service = new StartPracticeAttemptService(dataSource, {
    practiceExercises: exercises,
    practiceAttempts: attempts,
  });
  return { service };
}

function assertStartErr(err: unknown, code: StartPracticeAttemptErrorCode): true {
  assert.ok(err instanceof StartPracticeAttemptError);
  assert.equal(err.code, code);
  return true;
}

describe('StartPracticeAttemptService.execute — create', () => {
  it('creates a new attempt when none is active', async () => {
    const { service } = makeService();
    const result = await service.execute(USER_ID, EXERCISE_ID, STARTED_AT);
    assert.equal(result.resumed, false);
    assert.equal(result.view.attempt.exerciseId, EXERCISE_ID);
    assert.equal(result.view.attempt.totalCount, 8);
    assert.equal(result.view.result, null);
  });

  it('rejects an unknown/foreign/deleted exercise', async () => {
    const { service } = makeService({ findByIdForUser: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, EXERCISE_ID, STARTED_AT),
      (err: unknown) => assertStartErr(err, StartPracticeAttemptErrorCode.EXERCISE_NOT_FOUND),
    );
  });

  it('rejects missing input', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute('', EXERCISE_ID, STARTED_AT),
      (err: unknown) => assertStartErr(err, StartPracticeAttemptErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, EXERCISE_ID, new Date('invalid')),
      (err: unknown) => assertStartErr(err, StartPracticeAttemptErrorCode.INVALID_INPUT),
    );
  });
});

describe('StartPracticeAttemptService.execute — resume', () => {
  it('resumes an active attempt on the same exercise', async () => {
    const active = makeAttempt();
    const { service } = makeService({ findActiveByUser: async () => active });
    const result = await service.execute(USER_ID, EXERCISE_ID, STARTED_AT);
    assert.equal(result.resumed, true);
    assert.equal(result.view.attempt.id, 'attempt-id');
  });

  it('rejects with 409-mapped code when the active attempt is on a different exercise', async () => {
    const active = makeAttempt({ exercise_id: 'a-different-exercise' });
    const { service } = makeService({ findActiveByUser: async () => active });
    await assert.rejects(
      () => service.execute(USER_ID, EXERCISE_ID, STARTED_AT),
      (err: unknown) =>
        assertStartErr(err, StartPracticeAttemptErrorCode.ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE),
    );
  });
});

describe('StartPracticeAttemptService.execute — race handling', () => {
  it('retries once and resumes when the constraint is violated by a concurrent create', async () => {
    let findActiveCalls = 0;
    const winner = makeAttempt();
    const { service } = makeService({
      findActiveByUser: async () => {
        findActiveCalls += 1;
        // First call (pre-insert check): nothing active yet.
        // Second call (retry, after the race): the winner is now visible.
        return findActiveCalls === 1 ? null : winner;
      },
      createAttempt: async () => {
        throw pgUniqueViolation('uq_practice_attempts_one_active_per_user');
      },
    });

    const result = await service.execute(USER_ID, EXERCISE_ID, STARTED_AT);
    assert.equal(result.resumed, true);
    assert.equal(findActiveCalls, 2);
  });

  it('gives up after the retry with RACE_UNRESOLVED if still conflicting', async () => {
    const { service } = makeService({
      createAttempt: async () => {
        throw pgUniqueViolation('uq_practice_attempts_one_active_per_user');
      },
    });

    await assert.rejects(
      () => service.execute(USER_ID, EXERCISE_ID, STARTED_AT),
      (err: unknown) => assertStartErr(err, StartPracticeAttemptErrorCode.RACE_UNRESOLVED),
    );
  });

  it('does not treat an unrelated 23505 as the active-attempt race', async () => {
    const { service } = makeService({
      createAttempt: async () => {
        throw pgUniqueViolation('some_other_constraint');
      },
    });

    await assert.rejects(() => service.execute(USER_ID, EXERCISE_ID, STARTED_AT));
  });

  it('propagates a completely unrelated error untouched', async () => {
    const { service } = makeService({
      createAttempt: async () => {
        throw new Error('connection lost');
      },
    });

    await assert.rejects(
      () => service.execute(USER_ID, EXERCISE_ID, STARTED_AT),
      /connection lost/,
    );
  });
});
