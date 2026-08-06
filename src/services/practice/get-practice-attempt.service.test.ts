import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GetPracticeAttemptService,
  GetPracticeAttemptError,
  GetPracticeAttemptErrorCode,
} from './get-practice-attempt.service';
import type {
  PracticeAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  PracticeAnswersRepositoryPort,
} from './get-practice-attempt.service';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import { PracticeAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-id';

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
    itemCount: 1,
    createdAt: new Date(),
  },
  items: [],
};

function makeAttempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    exercise_id: 'exercise-id',
    status: PracticeAttemptStatus.IN_PROGRESS,
    started_at: new Date('2026-01-01T00:00:00.000Z'),
    submitted_at: null,
    duration_seconds: null,
    correct_count: null,
    total_count: 1,
    percentage: null,
    feedback_summary: null,
    ...overrides,
  } as unknown as PracticeAttempt;
}

const ITEM = {
  id: 'item-1',
  position: 1,
  prompt: 'p',
  options: null,
  answer_key: { kind: 'text', acceptedAnswers: ['x'], caseSensitive: false },
  explanation: 'e',
  skill_tags: [],
} as unknown as PracticeItem;

const ANSWER = {
  item_id: 'item-1',
  answer_payload: { kind: 'text', value: 'x' },
  normalized_answer: 'x',
  is_correct: true,
  response_time_ms: 100,
} as unknown as PracticeAnswer;

interface Overrides {
  findByIdForUser?: PracticeAttemptsRepositoryPort['findByIdForUser'];
  findSafeExerciseWithItemsForUser?: PracticeExercisesRepositoryPort['findSafeExerciseWithItemsForUser'];
  findExerciseWithAnswerKeysForEvaluation?: PracticeExercisesRepositoryPort['findExerciseWithAnswerKeysForEvaluation'];
  findByAttemptForUser?: PracticeAnswersRepositoryPort['findByAttemptForUser'];
}

function makeService(overrides: Overrides = {}): GetPracticeAttemptService {
  return new GetPracticeAttemptService({
    attempts: { findByIdForUser: overrides.findByIdForUser ?? (async () => makeAttempt()) },
    exercises: {
      findSafeExerciseWithItemsForUser:
        overrides.findSafeExerciseWithItemsForUser ?? (async () => SAFE_EXERCISE),
      findExerciseWithAnswerKeysForEvaluation:
        overrides.findExerciseWithAnswerKeysForEvaluation ?? (async () => ({ items: [ITEM] })),
    },
    answers: { findByAttemptForUser: overrides.findByAttemptForUser ?? (async () => [ANSWER]) },
  });
}

describe('GetPracticeAttemptService.execute', () => {
  it('throws ATTEMPT_NOT_FOUND for a missing/foreign/deleted attempt', async () => {
    const service = makeService({ findByIdForUser: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof GetPracticeAttemptError);
        assert.equal(err.code, GetPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND);
        return true;
      },
    );
  });

  it('returns the safe exercise and result:null for an in_progress attempt', async () => {
    const service = makeService({ findByIdForUser: async () => makeAttempt() });
    const view = await service.execute(USER_ID, ATTEMPT_ID);
    assert.deepEqual(view.exercise, SAFE_EXERCISE);
    assert.equal(view.result, null);
  });

  it('returns the safe exercise and result:null for an abandoned attempt', async () => {
    const service = makeService({
      findByIdForUser: async () => makeAttempt({ status: PracticeAttemptStatus.ABANDONED }),
    });
    const view = await service.execute(USER_ID, ATTEMPT_ID);
    assert.notEqual(view.exercise, null);
    assert.equal(view.result, null);
  });

  it('never selects/exposes answerKey or explanation for a non-completed attempt', async () => {
    const service = makeService({ findByIdForUser: async () => makeAttempt() });
    const view = await service.execute(USER_ID, ATTEMPT_ID);
    assert.doesNotMatch(JSON.stringify(view), /answerKey|explanation/);
  });

  it('returns the full result (with correctness/explanation) for a completed attempt', async () => {
    const completed = makeAttempt({
      status: PracticeAttemptStatus.COMPLETED,
      submitted_at: new Date('2026-01-01T00:05:00.000Z'),
      duration_seconds: 300,
      correct_count: 1,
      total_count: 1,
      percentage: '100.00',
      feedback_summary: {
        version: 'practice-attempt-feedback-v1',
        unansweredCount: 0,
        skillBreakdown: [],
      },
    });
    const service = makeService({ findByIdForUser: async () => completed });
    const view = await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(view.exercise, null);
    assert.ok(view.result !== null);
    assert.equal(view.result?.items[0]?.isCorrect, true);
    assert.equal(view.result?.items[0]?.explanation, 'e');
  });

  it('scopes the answer key evaluation lookup and answers query to the owning user', async () => {
    const completed = makeAttempt({
      status: PracticeAttemptStatus.COMPLETED,
      submitted_at: new Date(),
      duration_seconds: 1,
      correct_count: 1,
      total_count: 1,
      percentage: '100.00',
      feedback_summary: {
        version: 'practice-attempt-feedback-v1',
        unansweredCount: 0,
        skillBreakdown: [],
      },
    });
    let evalUserId: string | undefined;
    let answersUserId: string | undefined;
    const service = makeService({
      findByIdForUser: async () => completed,
      findExerciseWithAnswerKeysForEvaluation: async (_exerciseId, userId) => {
        evalUserId = userId;
        return { items: [ITEM] };
      },
      findByAttemptForUser: async (_attemptId, userId) => {
        answersUserId = userId;
        return [ANSWER];
      },
    });
    await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(evalUserId, USER_ID);
    assert.equal(answersUserId, USER_ID);
  });
});
