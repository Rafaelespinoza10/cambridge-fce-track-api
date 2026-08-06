import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { GetActivePracticeAttemptService } from './get-active-practice-attempt.service';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import { PracticeAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';

const ACTIVE_ATTEMPT = {
  id: 'attempt-id',
  user_id: USER_ID,
  exercise_id: 'exercise-id',
  status: PracticeAttemptStatus.IN_PROGRESS,
  started_at: new Date(),
  total_count: 8,
} as unknown as PracticeAttempt;

const SAFE_EXERCISE: PracticeExerciseSafeWithItems = {
  exercise: {
    id: 'exercise-id',
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

describe('GetActivePracticeAttemptService.execute', () => {
  it('returns { attempt: null } when there is no active attempt', async () => {
    const service = new GetActivePracticeAttemptService({
      repository: { findActiveByUser: async () => null },
      exercisesRepository: { findSafeExerciseWithItemsForUser: async () => SAFE_EXERCISE },
    });
    const result = await service.execute(USER_ID);
    assert.deepEqual(result, { attempt: null });
  });

  it('returns the safe view when an active attempt exists', async () => {
    const service = new GetActivePracticeAttemptService({
      repository: { findActiveByUser: async () => ACTIVE_ATTEMPT },
      exercisesRepository: { findSafeExerciseWithItemsForUser: async () => SAFE_EXERCISE },
    });
    const result = await service.execute(USER_ID);
    assert.ok('attempt' in result && result.attempt !== null);
    if ('exercise' in result) {
      assert.deepEqual(result.exercise, SAFE_EXERCISE);
      assert.equal(result.result, null);
    }
  });

  it('never selects/exposes answerKey or explanation (safe exercise projection only)', async () => {
    const service = new GetActivePracticeAttemptService({
      repository: { findActiveByUser: async () => ACTIVE_ATTEMPT },
      exercisesRepository: { findSafeExerciseWithItemsForUser: async () => SAFE_EXERCISE },
    });
    const result = (await service.execute(USER_ID)) as { exercise: PracticeExerciseSafeWithItems };
    const serialized = JSON.stringify(result.exercise);
    assert.doesNotMatch(serialized, /answerKey|explanation/);
  });

  it('scopes the lookup to the given userId', async () => {
    let capturedUserId: string | undefined;
    const service = new GetActivePracticeAttemptService({
      repository: {
        findActiveByUser: async (userId) => {
          capturedUserId = userId;
          return null;
        },
      },
      exercisesRepository: { findSafeExerciseWithItemsForUser: async () => SAFE_EXERCISE },
    });
    await service.execute(USER_ID);
    assert.equal(capturedUserId, USER_ID);
  });
});
