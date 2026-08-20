import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  SubmitPracticeAttemptService,
  SubmitPracticeAttemptError,
  SubmitPracticeAttemptErrorCode,
} from './submit-practice-attempt.service';
import type {
  PracticeAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  PracticeAnswersRepositoryPort,
} from './submit-practice-attempt.service';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import type { CreateAnswerData } from '../../repositories/practice-answers.repository';
import { PracticeAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-id';
const EXERCISE_ID = 'exercise-id';
const STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const SUBMITTED_AT = new Date('2026-01-01T00:05:00.000Z'); // +300s

function makeAttempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    exercise_id: EXERCISE_ID,
    status: PracticeAttemptStatus.IN_PROGRESS,
    started_at: STARTED_AT,
    submitted_at: null,
    duration_seconds: null,
    correct_count: null,
    total_count: 2,
    percentage: null,
    feedback_summary: null,
    plan_day_id: null,
    ...overrides,
  } as unknown as PracticeAttempt;
}

const ITEM_1 = {
  id: 'item-1',
  position: 1,
  prompt: 'p1',
  options: [
    { id: 'a', label: 'alpha' },
    { id: 'b', label: 'beta' },
  ],
  answer_key: { kind: 'single_choice', acceptedOptionIds: ['a'] },
  explanation: 'e1',
  skill_tags: ['collocations'],
} as unknown as PracticeItem;

const ITEM_2 = {
  id: 'item-2',
  position: 2,
  prompt: 'p2',
  options: null,
  answer_key: { kind: 'text', acceptedAnswers: ['been'], caseSensitive: false },
  explanation: 'e2',
  skill_tags: ['present-perfect'],
} as unknown as PracticeItem;

interface RepoState {
  createAnswersCalls: CreateAnswerData[][];
  completeAttemptCalls: { attemptId: string; userId: string; data: unknown }[];
  findByIdForUpdateCalls: number;
  createAiLinkedActivityCalls: unknown[];
}

interface Overrides {
  findByIdForUpdate?: PracticeAttemptsRepositoryPort['findByIdForUpdate'];
  findExerciseWithAnswerKeysForEvaluation?: PracticeExercisesRepositoryPort['findExerciseWithAnswerKeysForEvaluation'];
  findByAttemptForUser?: PracticeAnswersRepositoryPort['findByAttemptForUser'];
  completeAttemptResult?: { affected?: number | null };
}

function makeService(overrides: Overrides = {}): {
  service: SubmitPracticeAttemptService;
  state: RepoState;
} {
  const state: RepoState = {
    createAnswersCalls: [],
    completeAttemptCalls: [],
    findByIdForUpdateCalls: 0,
    createAiLinkedActivityCalls: [],
  };

  const dataSource = {
    transaction: async <T>(work: (manager: never) => Promise<T>) => work({} as never),
  } as unknown as DataSource;

  const attempts = (): PracticeAttemptsRepositoryPort => ({
    findByIdForUpdate: async (attemptId, userId, manager) => {
      state.findByIdForUpdateCalls += 1;
      return overrides.findByIdForUpdate
        ? overrides.findByIdForUpdate(attemptId, userId, manager)
        : makeAttempt();
    },
    completeAttempt: async (attemptId, userId, data) => {
      state.completeAttemptCalls.push({ attemptId, userId, data });
      return overrides.completeAttemptResult ?? { affected: 1 };
    },
  });

  const exercises = (): PracticeExercisesRepositoryPort => ({
    findExerciseWithAnswerKeysForEvaluation:
      overrides.findExerciseWithAnswerKeysForEvaluation ??
      (async () => ({
        items: [ITEM_1, ITEM_2],
        exercise: { title: 'Word Formation Exercise', part_code: 'UOE_PART_3' },
      })),
  });

  const answers = (): PracticeAnswersRepositoryPort => ({
    createAnswers: async (data) => {
      state.createAnswersCalls.push(data);
      return [];
    },
    findByAttemptForUser: overrides.findByAttemptForUser ?? (async () => []),
  });

  const service = new SubmitPracticeAttemptService(dataSource, {
    practiceAttempts: attempts,
    practiceExercises: exercises,
    practiceAnswers: answers,
    createAiLinkedActivity: async (_manager, input) => {
      state.createAiLinkedActivityCalls.push(input);
    },
  });
  return { service, state };
}

function fullAnswers() {
  return [
    { itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'a' } },
    { itemId: 'item-2', answer: { kind: 'text', value: 'been' } },
  ];
}

function assertSubmitErr(err: unknown, code: SubmitPracticeAttemptErrorCode): true {
  assert.ok(err instanceof SubmitPracticeAttemptError);
  assert.equal(err.code, code);
  return true;
}

// ── validation ───────────────────────────────────────────────────────────────

describe('SubmitPracticeAttemptService.execute — validation', () => {
  it('rejects a non-array answers payload', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'not-an-array', SUBMITTED_AT),
      (err: unknown) => assertSubmitErr(err, SubmitPracticeAttemptErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a malformed answer entry (bad kind)', async () => {
    const { service } = makeService();
    await assert.rejects(
      () =>
        service.execute(
          USER_ID,
          ATTEMPT_ID,
          [{ itemId: 'item-1', answer: { kind: 'bogus' } }],
          SUBMITTED_AT,
        ),
      (err: unknown) => assertSubmitErr(err, SubmitPracticeAttemptErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a negative responseTimeMs', async () => {
    const { service } = makeService();
    await assert.rejects(() =>
      service.execute(
        USER_ID,
        ATTEMPT_ID,
        [
          {
            itemId: 'item-1',
            answer: { kind: 'single_choice', optionId: 'a' },
            responseTimeMs: -5,
          },
        ],
        SUBMITTED_AT,
      ),
    );
  });

  it('rejects duplicate answers for the same item', async () => {
    const { service } = makeService();
    await assert.rejects(
      () =>
        service.execute(
          USER_ID,
          ATTEMPT_ID,
          [
            { itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'a' } },
            { itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'b' } },
          ],
          SUBMITTED_AT,
        ),
      (err: unknown) => assertSubmitErr(err, SubmitPracticeAttemptErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an item that does not belong to this exercise', async () => {
    const { service } = makeService();
    await assert.rejects(
      () =>
        service.execute(
          USER_ID,
          ATTEMPT_ID,
          [{ itemId: 'not-in-this-exercise', answer: { kind: 'unanswered' } }],
          SUBMITTED_AT,
        ),
      (err: unknown) => assertSubmitErr(err, SubmitPracticeAttemptErrorCode.INVALID_INPUT),
    );
  });
});

// ── ownership / status ──────────────────────────────────────────────────────

describe('SubmitPracticeAttemptService.execute — ownership and status', () => {
  it('throws ATTEMPT_NOT_FOUND for a missing/foreign/deleted attempt', async () => {
    const { service } = makeService({ findByIdForUpdate: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT),
      (err: unknown) => assertSubmitErr(err, SubmitPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND),
    );
  });

  it('throws ATTEMPT_ABANDONED for an abandoned attempt', async () => {
    const { service } = makeService({
      findByIdForUpdate: async () => makeAttempt({ status: PracticeAttemptStatus.ABANDONED }),
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT),
      (err: unknown) => assertSubmitErr(err, SubmitPracticeAttemptErrorCode.ATTEMPT_ABANDONED),
    );
  });

  it('locks the attempt row via findByIdForUpdate', async () => {
    const { service, state } = makeService();
    await service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT);
    assert.equal(state.findByIdForUpdateCalls, 1);
  });
});

// ── grading ──────────────────────────────────────────────────────────────────

describe('SubmitPracticeAttemptService.execute — grading', () => {
  it('grades single_choice and text items correctly, computes percentage/duration', async () => {
    const { service } = makeService();
    const { result, idempotentReplay } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      fullAnswers(),
      SUBMITTED_AT,
    );
    assert.equal(idempotentReplay, false);
    assert.equal(result.correctCount, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.percentage, 100);
    assert.equal(result.durationSeconds, 300);
  });

  it('treats an omitted item as unanswered (always incorrect)', async () => {
    const { service } = makeService();
    const { result } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [{ itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'a' } }], // item-2 omitted
      SUBMITTED_AT,
    );
    assert.equal(result.correctCount, 1);
    assert.equal(result.totalCount, 2);
    assert.equal(result.percentage, 50);
    const item2Result = result.items.find((i) => i.itemId === 'item-2');
    assert.equal(item2Result?.isCorrect, false);
    assert.deepEqual(item2Result?.userAnswer, { kind: 'unanswered' });
  });

  it('persists exactly one answer per item, never partial', async () => {
    const { service, state } = makeService();
    await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [{ itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'a' } }],
      SUBMITTED_AT,
    );
    const created = state.createAnswersCalls[0]!;
    assert.equal(created.length, 2);
    assert.deepEqual(created.map((a) => a.itemId).sort(), ['item-1', 'item-2']);
  });

  it('strips a client-spoofed isCorrect/score from the stored payload', async () => {
    const { service, state } = makeService();
    await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [
        {
          itemId: 'item-1',
          answer: { kind: 'single_choice', optionId: 'b', isCorrect: true, score: 999 },
        },
        { itemId: 'item-2', answer: { kind: 'text', value: 'been' } },
      ],
      SUBMITTED_AT,
    );
    const item1Answer = state.createAnswersCalls[0]!.find((a) => a.itemId === 'item-1')!;
    assert.deepEqual(item1Answer.answerPayload, { kind: 'single_choice', optionId: 'b' });
    // The spoofed isCorrect: true is irrelevant — 'b' is genuinely wrong (accepted is 'a').
    assert.equal(item1Answer.isCorrect, false);
  });

  it('attaches a feedback summary with a skill breakdown', async () => {
    const { service } = makeService();
    const { result } = await service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT);
    assert.equal(result.feedbackSummary.version, 'practice-attempt-feedback-v1');
    assert.ok(result.feedbackSummary.skillBreakdown.length > 0);
  });

  it('completes the attempt with server-computed values only', async () => {
    const { service, state } = makeService();
    await service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT);
    const call = state.completeAttemptCalls[0]!;
    assert.equal(call.attemptId, ATTEMPT_ID);
    assert.equal(call.userId, USER_ID);
  });
});

// ── AI-linked planned activity ──────────────────────────────────────────────

describe('SubmitPracticeAttemptService.execute — AI-linked planned activity', () => {
  const PLAN_DAY_ID = '33333333-3333-3333-3333-333333333333';

  it('creates a linked planned_activity when the attempt targets a plan day', async () => {
    const { service, state } = makeService({
      findByIdForUpdate: async () => makeAttempt({ plan_day_id: PLAN_DAY_ID }),
    });
    await service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT);

    assert.equal(state.createAiLinkedActivityCalls.length, 1);
    const input = state.createAiLinkedActivityCalls[0] as Record<string, unknown>;
    assert.equal(input.planDayId, PLAN_DAY_ID);
    assert.equal(input.skillSlug, 'use-of-english');
    assert.equal(input.examSectionSlug, 'uoe-part-3');
    assert.equal(input.practiceAttemptId, ATTEMPT_ID);
    assert.equal(input.completedAt, SUBMITTED_AT);
  });

  it('does not create a planned_activity when the attempt has no target day', async () => {
    const { service, state } = makeService({
      findByIdForUpdate: async () => makeAttempt({ plan_day_id: null }),
    });
    await service.execute(USER_ID, ATTEMPT_ID, fullAnswers(), SUBMITTED_AT);
    assert.equal(state.createAiLinkedActivityCalls.length, 0);
  });

  it('does not create a duplicate planned_activity on an idempotent replay', async () => {
    const completed = makeAttempt({
      status: PracticeAttemptStatus.COMPLETED,
      plan_day_id: PLAN_DAY_ID,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 300,
      correct_count: 2,
      total_count: 2,
      percentage: '100.00',
      feedback_summary: {
        version: 'practice-attempt-feedback-v1',
        unansweredCount: 0,
        skillBreakdown: [],
      },
    });
    const { service, state } = makeService({
      findByIdForUpdate: async () => completed,
      findByAttemptForUser: async () => [
        {
          item_id: 'item-1',
          answer_payload: { kind: 'single_choice', optionId: 'a' },
          normalized_answer: 'a',
          is_correct: true,
          response_time_ms: 100,
        },
        {
          item_id: 'item-2',
          answer_payload: { kind: 'text', value: 'been' },
          normalized_answer: 'been',
          is_correct: true,
          response_time_ms: 200,
        },
      ] as unknown as PracticeAnswer[],
    });
    const { idempotentReplay } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      fullAnswers(),
      SUBMITTED_AT,
    );
    assert.equal(idempotentReplay, true);
    assert.equal(state.createAiLinkedActivityCalls.length, 0);
  });
});

// ── idempotent replay ────────────────────────────────────────────────────────

describe('SubmitPracticeAttemptService.execute — idempotent replay', () => {
  it('replays a completed attempt without inserting answers or recomputing', async () => {
    const completed = makeAttempt({
      status: PracticeAttemptStatus.COMPLETED,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 300,
      correct_count: 2,
      total_count: 2,
      percentage: '100.00',
      feedback_summary: {
        version: 'practice-attempt-feedback-v1',
        unansweredCount: 0,
        skillBreakdown: [],
      },
    });
    const persistedAnswers = [
      {
        item_id: 'item-1',
        answer_payload: { kind: 'single_choice', optionId: 'a' },
        normalized_answer: 'a',
        is_correct: true,
        response_time_ms: 100,
      },
      {
        item_id: 'item-2',
        answer_payload: { kind: 'text', value: 'been' },
        normalized_answer: 'been',
        is_correct: true,
        response_time_ms: 200,
      },
    ] as unknown as PracticeAnswer[];

    const { service, state } = makeService({
      findByIdForUpdate: async () => completed,
      findByAttemptForUser: async () => persistedAnswers,
    });

    const { result, idempotentReplay } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      fullAnswers(),
      SUBMITTED_AT,
    );

    assert.equal(idempotentReplay, true);
    assert.equal(result.correctCount, 2);
    assert.equal(state.createAnswersCalls.length, 0);
    assert.equal(state.completeAttemptCalls.length, 0);
  });
});
