import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  PracticeExercisesService,
  PracticeExerciseError,
  PracticeExerciseErrorCode,
} from './practice-exercises.service';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const EXERCISE_ID = '22222222-2222-2222-2222-222222222222';

const SAFE_RESULT: PracticeExerciseSafeWithItems = {
  exercise: {
    id: EXERCISE_ID,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    targetLevel: 'B2' as never,
    title: 'Use of English - Part 1',
    instructions: 'Choose the correct word for each gap.',
    stimulus: 'A passage with gaps.',
    timeLimitSeconds: null,
    itemCount: 8,
    createdAt: new Date(),
  },
  items: [],
};

describe('PracticeExercisesService.getExercise', () => {
  it('returns the safe projection when found', async () => {
    const service = new PracticeExercisesService({
      repository: { findSafeExerciseWithItemsForUser: async () => SAFE_RESULT },
    });

    const result = await service.getExercise(USER_ID, EXERCISE_ID);
    assert.deepEqual(result, SAFE_RESULT);
  });

  it('passes exerciseId and userId through to the repository', async () => {
    let capturedArgs: [string, string] | undefined;
    const service = new PracticeExercisesService({
      repository: {
        findSafeExerciseWithItemsForUser: async (exerciseId, userId) => {
          capturedArgs = [exerciseId, userId];
          return SAFE_RESULT;
        },
      },
    });

    await service.getExercise(USER_ID, EXERCISE_ID);
    assert.deepEqual(capturedArgs, [EXERCISE_ID, USER_ID]);
  });

  it('throws EXERCISE_NOT_FOUND when the repository returns null', async () => {
    const service = new PracticeExercisesService({
      repository: { findSafeExerciseWithItemsForUser: async () => null },
    });

    await assert.rejects(
      () => service.getExercise(USER_ID, EXERCISE_ID),
      (err: unknown) => {
        assert.ok(err instanceof PracticeExerciseError);
        assert.equal(err.code, PracticeExerciseErrorCode.EXERCISE_NOT_FOUND);
        return true;
      },
    );
  });
});
