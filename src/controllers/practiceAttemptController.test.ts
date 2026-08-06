process.env.JWT_SECRET = 'test-secret-for-practice-attempt-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  startPracticeAttempt,
  startPracticeAttemptHandler,
  getActivePracticeAttempt,
  getActivePracticeAttemptHandler,
  getPracticeAttempt,
  getPracticeAttemptHandler,
  submitPracticeAttempt,
  submitPracticeAttemptHandler,
  abandonPracticeAttempt,
  abandonPracticeAttemptHandler,
  listPracticeAttemptHistory,
  listPracticeAttemptHistoryHandler,
  generatePracticeErrorFlashcardDraft,
  generatePracticeErrorFlashcardDraftHandler,
} from './practiceAttemptController';
import type {
  PracticeAttemptControllerDeps,
  StartAttemptPort,
  GetActiveAttemptPort,
  GetAttemptPort,
  SubmitAttemptPort,
  AbandonAttemptPort,
  ListAttemptHistoryPort,
  GenerateErrorFlashcardDraftPort,
} from './practiceAttemptController';
import { JwtService } from '../lib/jwt';
import { PracticeAttemptStatus, FlashcardType, EnglishLevel } from '../models/enums';
import {
  StartPracticeAttemptError,
  StartPracticeAttemptErrorCode,
} from '../services/practice/start-practice-attempt.service';
import {
  GetPracticeAttemptError,
  GetPracticeAttemptErrorCode,
} from '../services/practice/get-practice-attempt.service';
import {
  SubmitPracticeAttemptError,
  SubmitPracticeAttemptErrorCode,
} from '../services/practice/submit-practice-attempt.service';
import {
  AbandonPracticeAttemptError,
  AbandonPracticeAttemptErrorCode,
} from '../services/practice/abandon-practice-attempt.service';
import {
  ListPracticeAttemptHistoryError,
  ListPracticeAttemptHistoryErrorCode,
} from '../services/practice/list-practice-attempt-history.service';
import {
  GeneratePracticeErrorFlashcardDraftError,
  GeneratePracticeErrorFlashcardDraftErrorCode,
} from '../services/practice/generate-practice-error-flashcard-draft.service';
import type {
  PracticeAttemptStartResultDto,
  PracticeAttemptViewDto,
  PracticeAttemptSubmitResultDto,
  PracticeAttemptAbandonResultDto,
} from '../interfaces/practice/practice-attempt.interface';
import type { PracticeAttemptHistoryResponseDto } from '../interfaces/practice/practice-attempt-history.interface';
import type { PracticeErrorFlashcardDraftResponse } from '../interfaces/practice/practice-error-flashcard-draft.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const EXERCISE_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const FIXED_NOW = new Date('2026-01-15T14:30:00.000Z');

const TOKEN = JwtService.sign({ sub: USER_ID, email: 'user@example.com', role: 'student' });

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function parseBody(result: APIGatewayProxyResult): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

const SAFE_EXERCISE = {
  exercise: {
    id: EXERCISE_ID,
    examCode: 'B2First',
    paperCode: 'reading',
    partCode: 'part1',
    targetLevel: null,
    title: 'Title',
    instructions: 'Instructions',
    stimulus: null,
    timeLimitSeconds: null,
    itemCount: 8,
    createdAt: FIXED_NOW,
  },
  items: [],
};

const SAFE_ATTEMPT = {
  id: ATTEMPT_ID,
  exerciseId: EXERCISE_ID,
  status: PracticeAttemptStatus.IN_PROGRESS,
  startedAt: FIXED_NOW,
  totalCount: 8,
};

const START_RESULT: PracticeAttemptStartResultDto = {
  view: { attempt: SAFE_ATTEMPT, exercise: SAFE_EXERCISE, result: null },
  resumed: false,
};

const ACTIVE_VIEW: PracticeAttemptViewDto = {
  attempt: SAFE_ATTEMPT,
  exercise: SAFE_EXERCISE,
  result: null,
};

const RESULT_DTO = {
  attemptId: ATTEMPT_ID,
  exerciseId: EXERCISE_ID,
  submittedAt: FIXED_NOW,
  durationSeconds: 120,
  correctCount: 6,
  totalCount: 8,
  percentage: 75,
  feedbackSummary: {
    version: 'practice-attempt-feedback-v1' as const,
    unansweredCount: 1,
    skillBreakdown: [],
  },
  items: [],
};

const SUBMIT_RESULT: PracticeAttemptSubmitResultDto = {
  result: RESULT_DTO,
  idempotentReplay: false,
};

const ABANDON_RESULT: PracticeAttemptAbandonResultDto = {
  attempt: { ...SAFE_ATTEMPT, status: PracticeAttemptStatus.ABANDONED },
  idempotentReplay: false,
};

const HISTORY_RESULT: PracticeAttemptHistoryResponseDto = {
  items: [
    {
      attemptId: ATTEMPT_ID,
      exerciseId: EXERCISE_ID,
      status: PracticeAttemptStatus.COMPLETED,
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      targetLevel: null,
      title: 'Title',
      itemCount: 8,
      startedAt: FIXED_NOW,
      submittedAt: FIXED_NOW,
      durationSeconds: 120,
      correctCount: 6,
      totalCount: 8,
      percentage: 75,
      unansweredCount: 1,
    },
  ],
  pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
};

const DRAFT_RESULT: PracticeErrorFlashcardDraftResponse = {
  draft: {
    type: FlashcardType.GRAMMAR,
    front: 'Which preposition follows "depend"?',
    back: 'depend on',
    translation: 'depender de',
    example: 'Your progress depends on consistent practice.',
    personalExample: 'My Cambridge progress depends on studying every day.',
    notes: 'Use "depend on", not "depend of".',
    sourceName: null,
    sourceUrl: null,
    level: EnglishLevel.B1,
    tags: ['prepositions', 'grammar'],
  },
};

interface FakePorts {
  startAttempt: StartAttemptPort & { calls: Parameters<StartAttemptPort['execute']>[] };
  getActiveAttempt: GetActiveAttemptPort & { calls: Parameters<GetActiveAttemptPort['execute']>[] };
  getAttempt: GetAttemptPort & { calls: Parameters<GetAttemptPort['execute']>[] };
  submitAttempt: SubmitAttemptPort & { calls: Parameters<SubmitAttemptPort['execute']>[] };
  abandonAttempt: AbandonAttemptPort & { calls: Parameters<AbandonAttemptPort['execute']>[] };
  listAttemptHistory: ListAttemptHistoryPort & {
    calls: Parameters<ListAttemptHistoryPort['execute']>[];
  };
  generateErrorFlashcardDraft: GenerateErrorFlashcardDraftPort & {
    calls: Parameters<GenerateErrorFlashcardDraftPort['execute']>[];
  };
}

function buildDeps(
  overrides: {
    startExecute?: StartAttemptPort['execute'];
    getActiveExecute?: GetActiveAttemptPort['execute'];
    getExecute?: GetAttemptPort['execute'];
    submitExecute?: SubmitAttemptPort['execute'];
    abandonExecute?: AbandonAttemptPort['execute'];
    listHistoryExecute?: ListAttemptHistoryPort['execute'];
    generateErrorFlashcardDraftExecute?: GenerateErrorFlashcardDraftPort['execute'];
  } = {},
): { deps: PracticeAttemptControllerDeps; ports: FakePorts } {
  const startCalls: Parameters<StartAttemptPort['execute']>[] = [];
  const getActiveCalls: Parameters<GetActiveAttemptPort['execute']>[] = [];
  const getCalls: Parameters<GetAttemptPort['execute']>[] = [];
  const submitCalls: Parameters<SubmitAttemptPort['execute']>[] = [];
  const abandonCalls: Parameters<AbandonAttemptPort['execute']>[] = [];
  const listHistoryCalls: Parameters<ListAttemptHistoryPort['execute']>[] = [];
  const generateErrorFlashcardDraftCalls: Parameters<GenerateErrorFlashcardDraftPort['execute']>[] =
    [];

  const ports: FakePorts = {
    startAttempt: {
      calls: startCalls,
      execute: async (userId, exerciseId, startedAt) => {
        startCalls.push([userId, exerciseId, startedAt]);
        return overrides.startExecute
          ? overrides.startExecute(userId, exerciseId, startedAt)
          : START_RESULT;
      },
    },
    getActiveAttempt: {
      calls: getActiveCalls,
      execute: async (userId) => {
        getActiveCalls.push([userId]);
        return overrides.getActiveExecute ? overrides.getActiveExecute(userId) : ACTIVE_VIEW;
      },
    },
    getAttempt: {
      calls: getCalls,
      execute: async (userId, attemptId) => {
        getCalls.push([userId, attemptId]);
        return overrides.getExecute ? overrides.getExecute(userId, attemptId) : ACTIVE_VIEW;
      },
    },
    submitAttempt: {
      calls: submitCalls,
      execute: async (userId, attemptId, rawAnswers, submittedAt) => {
        submitCalls.push([userId, attemptId, rawAnswers, submittedAt]);
        return overrides.submitExecute
          ? overrides.submitExecute(userId, attemptId, rawAnswers, submittedAt)
          : SUBMIT_RESULT;
      },
    },
    abandonAttempt: {
      calls: abandonCalls,
      execute: async (userId, attemptId) => {
        abandonCalls.push([userId, attemptId]);
        return overrides.abandonExecute
          ? overrides.abandonExecute(userId, attemptId)
          : ABANDON_RESULT;
      },
    },
    listAttemptHistory: {
      calls: listHistoryCalls,
      execute: async (userId, rawQuery) => {
        listHistoryCalls.push([userId, rawQuery]);
        return overrides.listHistoryExecute
          ? overrides.listHistoryExecute(userId, rawQuery)
          : HISTORY_RESULT;
      },
    },
    generateErrorFlashcardDraft: {
      calls: generateErrorFlashcardDraftCalls,
      execute: async (userId, attemptId, itemId) => {
        generateErrorFlashcardDraftCalls.push([userId, attemptId, itemId]);
        return overrides.generateErrorFlashcardDraftExecute
          ? overrides.generateErrorFlashcardDraftExecute(userId, attemptId, itemId)
          : DRAFT_RESULT;
      },
    },
  };

  const deps: PracticeAttemptControllerDeps = {
    now: () => FIXED_NOW,
    services: async () => ports,
  };

  return { deps, ports };
}

// ── startPracticeAttempt ─────────────────────────────────────────────────────────

describe('startPracticeAttempt', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await startPracticeAttemptHandler(
      makeEvent({ headers: {}, pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid exerciseId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: 'not-a-uuid' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects a missing exerciseId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await startPracticeAttemptHandler(makeEvent({ pathParameters: null }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('returns 201 and resumed:false when the service creates a new attempt', async () => {
    const { deps } = buildDeps();
    const result = await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 201);
    const body = parseBody(result);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.resumed, false);
    assert.deepEqual(data.attempt, JSON.parse(JSON.stringify(SAFE_ATTEMPT)));
  });

  it('returns 200 and resumed:true when the service resumes an existing attempt', async () => {
    const { deps } = buildDeps({
      startExecute: async () => ({ view: START_RESULT.view, resumed: true }),
    });
    const result = await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal((parseBody(result).data as Record<string, unknown>).resumed, true);
  });

  it('takes userId from the JWT and startedAt from the server clock', async () => {
    const { deps, ports } = buildDeps();
    await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.deepEqual(ports.startAttempt.calls[0], [USER_ID, EXERCISE_ID, FIXED_NOW]);
  });

  it('maps EXERCISE_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      startExecute: async () => {
        throw new StartPracticeAttemptError(
          'nope',
          StartPracticeAttemptErrorCode.EXERCISE_NOT_FOUND,
        );
      },
    });
    const result = await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('maps ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE to 409', async () => {
    const { deps } = buildDeps({
      startExecute: async () => {
        throw new StartPracticeAttemptError(
          'conflict',
          StartPracticeAttemptErrorCode.ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE,
        );
      },
    });
    const result = await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      startExecute: async () => {
        throw new Error('ECONNREFUSED at 10.0.0.1');
      },
    });
    const result = await startPracticeAttemptHandler(
      makeEvent({ pathParameters: { exerciseId: EXERCISE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal((parseBody(result).message as string).includes('10.0.0.1'), false);
  });
});

// ── getActivePracticeAttempt ─────────────────────────────────────────────────────

describe('getActivePracticeAttempt', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getActivePracticeAttemptHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('returns { attempt: null } when there is no active attempt', async () => {
    const { deps } = buildDeps({ getActiveExecute: async () => ({ attempt: null }) });
    const result = await getActivePracticeAttemptHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, { attempt: null });
  });

  it('returns the active attempt with its safe exercise projection', async () => {
    const { deps } = buildDeps();
    const result = await getActivePracticeAttemptHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as Record<string, unknown>;
    assert.deepEqual(data.attempt, JSON.parse(JSON.stringify(SAFE_ATTEMPT)));
    assert.ok(data.exercise);
    assert.equal((data.exercise as Record<string, unknown>).answerKey, undefined);
    assert.equal(data.result, null);
  });

  it('takes userId from the JWT', async () => {
    const { deps, ports } = buildDeps();
    await getActivePracticeAttemptHandler(makeEvent(), deps);
    assert.deepEqual(ports.getActiveAttempt.calls[0], [USER_ID]);
  });
});

// ── getPracticeAttempt ────────────────────────────────────────────────────────────

describe('getPracticeAttempt', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getPracticeAttemptHandler(
      makeEvent({ headers: {}, pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid attemptId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await getPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: 'bad' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('returns the safe view for an in_progress attempt', async () => {
    const { deps } = buildDeps();
    const result = await getPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as Record<string, unknown>;
    assert.equal(data.result, null);
    assert.ok(data.exercise);
  });

  it('returns the full result for a completed attempt', async () => {
    const { deps } = buildDeps({
      getExecute: async () => ({
        attempt: { ...SAFE_ATTEMPT, status: PracticeAttemptStatus.COMPLETED },
        exercise: null,
        result: RESULT_DTO,
      }),
    });
    const result = await getPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    const data = parseBody(result).data as Record<string, unknown>;
    assert.equal(data.exercise, null);
    assert.ok(data.result);
  });

  it('maps ATTEMPT_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      getExecute: async () => {
        throw new GetPracticeAttemptError('nope', GetPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND);
      },
    });
    const result = await getPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

// ── submitPracticeAttempt ─────────────────────────────────────────────────────────

describe('submitPracticeAttempt', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await submitPracticeAttemptHandler(
      makeEvent({
        headers: {},
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid attemptId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await submitPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: 'bad' }, body: JSON.stringify({ answers: [] }) }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await submitPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID }, body: '{not json' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('forwards the raw answers array and lets the service validate its shape', async () => {
    const { deps, ports } = buildDeps();
    const answers = [{ itemId: 'item-1', answer: { kind: 'unanswered' } }];
    await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers }),
      }),
      deps,
    );
    assert.deepEqual(ports.submitAttempt.calls[0], [USER_ID, ATTEMPT_ID, answers, FIXED_NOW]);
  });

  it('takes submittedAt from the server clock, ignoring any client-supplied value', async () => {
    const { deps, ports } = buildDeps();
    await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [], submittedAt: '2000-01-01T00:00:00.000Z' }),
      }),
      deps,
    );
    assert.equal(ports.submitAttempt.calls[0][3], FIXED_NOW);
  });

  it('returns 200 with idempotentReplay:false on a first submission', async () => {
    const { deps } = buildDeps();
    const result = await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal((parseBody(result).data as Record<string, unknown>).idempotentReplay, false);
  });

  it('returns 200 with idempotentReplay:true on a replay', async () => {
    const { deps } = buildDeps({
      submitExecute: async () => ({ result: RESULT_DTO, idempotentReplay: true }),
    });
    const result = await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal((parseBody(result).data as Record<string, unknown>).idempotentReplay, true);
  });

  it('maps ATTEMPT_ABANDONED to 409', async () => {
    const { deps } = buildDeps({
      submitExecute: async () => {
        throw new SubmitPracticeAttemptError(
          'abandoned',
          SubmitPracticeAttemptErrorCode.ATTEMPT_ABANDONED,
        );
      },
    });
    const result = await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });

  it('maps INVALID_INPUT to 400', async () => {
    const { deps } = buildDeps({
      submitExecute: async () => {
        throw new SubmitPracticeAttemptError('bad', SubmitPracticeAttemptErrorCode.INVALID_INPUT);
      },
    });
    const result = await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      submitExecute: async () => {
        throw new Error('duplicate key value violates constraint xyz');
      },
    });
    const result = await submitPracticeAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal((parseBody(result).message as string).includes('constraint'), false);
  });
});

// ── abandonPracticeAttempt ────────────────────────────────────────────────────────

describe('abandonPracticeAttempt', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await abandonPracticeAttemptHandler(
      makeEvent({ headers: {}, pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid attemptId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await abandonPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: 'bad' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('abandons an in_progress attempt', async () => {
    const { deps } = buildDeps();
    const result = await abandonPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as Record<string, unknown>;
    assert.equal(data.idempotentReplay, false);
    assert.equal((data.attempt as Record<string, unknown>).status, PracticeAttemptStatus.ABANDONED);
  });

  it('replays idempotently when already abandoned', async () => {
    const { deps } = buildDeps({
      abandonExecute: async () => ({ ...ABANDON_RESULT, idempotentReplay: true }),
    });
    const result = await abandonPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal((parseBody(result).data as Record<string, unknown>).idempotentReplay, true);
  });

  it('maps ATTEMPT_COMPLETED to 409', async () => {
    const { deps } = buildDeps({
      abandonExecute: async () => {
        throw new AbandonPracticeAttemptError(
          'completed',
          AbandonPracticeAttemptErrorCode.ATTEMPT_COMPLETED,
        );
      },
    });
    const result = await abandonPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });

  it('maps ATTEMPT_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      abandonExecute: async () => {
        throw new AbandonPracticeAttemptError(
          'missing',
          AbandonPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND,
        );
      },
    });
    const result = await abandonPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('takes userId from the JWT', async () => {
    const { deps, ports } = buildDeps();
    await abandonPracticeAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.deepEqual(ports.abandonAttempt.calls[0], [USER_ID, ATTEMPT_ID]);
  });
});

// ── listPracticeAttemptHistory ────────────────────────────────────────────────────

describe('listPracticeAttemptHistory', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await listPracticeAttemptHistoryHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('returns 200 with the paginated history on success', async () => {
    const { deps } = buildDeps();
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as Record<string, unknown>;
    assert.deepEqual(data, JSON.parse(JSON.stringify(HISTORY_RESULT)));
  });

  it('serializes numeric fields as raw JSON numbers (not quoted strings) and dates as ISO strings', async () => {
    const { deps } = buildDeps();
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    // JSON.parse preserves the string/number distinction from the wire
    // format, so typeof here reflects exactly what was actually sent —
    // this would fail if any field were serialized as e.g. "75" (a quoted
    // string in the JSON body) instead of 75 (a raw JSON number).
    const item = (parseBody(result).data as { items: Record<string, unknown>[] }).items[0];
    for (const field of [
      'itemCount',
      'durationSeconds',
      'correctCount',
      'totalCount',
      'percentage',
      'unansweredCount',
    ]) {
      assert.equal(typeof item[field], 'number', `${field} should serialize as a JSON number`);
    }
    const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    assert.match(item.startedAt as string, isoDate);
    assert.match(item.submittedAt as string, isoDate);
  });

  it('forwards known query params (status/examCode/paperCode/partCode/page/pageSize) to the service, unvalidated', async () => {
    const { deps, ports } = buildDeps();
    await listPracticeAttemptHistoryHandler(
      makeEvent({
        queryStringParameters: {
          status: 'completed',
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_1',
          page: '2',
          pageSize: '10',
          unknownField: 'ignored',
        },
      }),
      deps,
    );
    assert.deepEqual(ports.listAttemptHistory.calls[0], [
      USER_ID,
      {
        status: 'completed',
        examCode: 'B2_FIRST',
        paperCode: 'PAPER_1',
        partCode: 'UOE_PART_1',
        page: '2',
        pageSize: '10',
      },
    ]);
  });

  it('passes undefined for every query param when none are sent', async () => {
    const { deps, ports } = buildDeps();
    await listPracticeAttemptHistoryHandler(makeEvent({ queryStringParameters: null }), deps);
    assert.deepEqual(ports.listAttemptHistory.calls[0], [
      USER_ID,
      {
        status: undefined,
        examCode: undefined,
        paperCode: undefined,
        partCode: undefined,
        page: undefined,
        pageSize: undefined,
      },
    ]);
  });

  it('takes userId from the JWT', async () => {
    const { deps, ports } = buildDeps();
    await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(ports.listAttemptHistory.calls[0][0], USER_ID);
  });

  it('maps INVALID_INPUT to 400', async () => {
    const { deps } = buildDeps({
      listHistoryExecute: async () => {
        throw new ListPracticeAttemptHistoryError(
          'x',
          ListPracticeAttemptHistoryErrorCode.INVALID_INPUT,
        );
      },
    });
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 400);
  });

  it('maps UNSUPPORTED_EXAM to 400', async () => {
    const { deps } = buildDeps({
      listHistoryExecute: async () => {
        throw new ListPracticeAttemptHistoryError(
          'x',
          ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_EXAM,
        );
      },
    });
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 400);
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', async () => {
    const { deps } = buildDeps({
      listHistoryExecute: async () => {
        throw new ListPracticeAttemptHistoryError(
          'x',
          ListPracticeAttemptHistoryErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      },
    });
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      listHistoryExecute: async () => {
        throw new Error('duplicate key value violates constraint xyz');
      },
    });
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal((parseBody(result).message as string).includes('constraint'), false);
  });

  it('an empty page returns 200 with an empty items array', async () => {
    const { deps } = buildDeps({
      listHistoryExecute: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      }),
    });
    const result = await listPracticeAttemptHistoryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, {
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
  });
});

// ── generatePracticeErrorFlashcardDraft ────────────────────────────────────────

describe('generatePracticeErrorFlashcardDraft', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ headers: {}, pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid attemptId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: 'not-a-uuid', itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects a missing attemptId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects an invalid itemId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: 'not-a-uuid' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects a missing itemId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('returns 200 with the draft on success', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, JSON.parse(JSON.stringify(DRAFT_RESULT)));
  });

  it('ignores any request body — no fields are ever read from it', async () => {
    const { deps, ports } = buildDeps();
    await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID },
        body: JSON.stringify({ front: 'client-supplied', deckId: 'sneaky-deck-id' }),
      }),
      deps,
    );
    assert.deepEqual(ports.generateErrorFlashcardDraft.calls[0], [USER_ID, ATTEMPT_ID, ITEM_ID]);
  });

  it('takes userId from the JWT and forwards attemptId/itemId from the path', async () => {
    const { deps, ports } = buildDeps();
    await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.deepEqual(ports.generateErrorFlashcardDraft.calls[0], [USER_ID, ATTEMPT_ID, ITEM_ID]);
  });

  it('maps ATTEMPT_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_FOUND,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('maps ATTEMPT_NOT_COMPLETED to 409', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_COMPLETED,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });

  it('maps PRACTICE_ITEM_NOT_INCORRECT to 409', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_INCORRECT,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });

  it('maps AI_RATE_LIMITED to 429', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.AI_RATE_LIMITED,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 429);
  });

  it('maps AI_INVALID_RESPONSE to 502', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 502);
  });

  it('maps AI_PROVIDER_UNAVAILABLE to 503', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 503);
  });

  it('maps AI_REQUEST_TIMEOUT to 504', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'x',
          GeneratePracticeErrorFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 504);
  });

  // A missing PracticeAnswer for a completed attempt/known item is internal
  // data corruption (PR 3 guarantees exactly one answer per item on a
  // completed attempt) — it must surface as a masked 500, never a 404.
  it('maps PERSISTENCE_INCONSISTENCY to 500, not 404', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new GeneratePracticeErrorFlashcardDraftError(
          'No persisted answer was found for this item on a completed attempt',
          GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 500);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      generateErrorFlashcardDraftExecute: async () => {
        throw new Error('OpenAI request failed: invoice #12345 over billing limit');
      },
    });
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal((parseBody(result).message as string).includes('invoice'), false);
  });

  it('the response never carries id/deckId/userId/status/scheduling/attemptId/itemId/answerKey', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeErrorFlashcardDraftHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } }),
      deps,
    );
    assert.doesNotMatch(
      result.body,
      /"id"|"deckId"|"userId"|"status"|"scheduling"|"attemptId"|"itemId"|"answerKey"/,
    );
  });
});

// ── Lambda invocation shape regression guard ────────────────────────────────────
//
// AWS Lambda always calls the exported handler as `handler(event, context)`.
// A prior version of a sibling controller took `deps = DEFAULT_DEPS` as its
// second parameter — since `context` is never `undefined`, the default never
// activated in production and every request crashed with `TypeError:
// deps.services is not a function`, masked as a generic 500 by handleError.
// This guards against that shape regressing across all 7 exported handlers.

describe('exported Lambda handlers ignore a second (context) argument', () => {
  const cases: [
    string,
    (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>,
    Partial<APIGatewayProxyEvent>,
  ][] = [
    ['startPracticeAttempt', startPracticeAttempt, { pathParameters: { exerciseId: EXERCISE_ID } }],
    ['getActivePracticeAttempt', getActivePracticeAttempt, {}],
    ['getPracticeAttempt', getPracticeAttempt, { pathParameters: { attemptId: ATTEMPT_ID } }],
    [
      'submitPracticeAttempt',
      submitPracticeAttempt,
      { pathParameters: { attemptId: ATTEMPT_ID }, body: JSON.stringify({ answers: [] }) },
    ],
    [
      'abandonPracticeAttempt',
      abandonPracticeAttempt,
      { pathParameters: { attemptId: ATTEMPT_ID } },
    ],
    ['listPracticeAttemptHistory', listPracticeAttemptHistory, {}],
    [
      'generatePracticeErrorFlashcardDraft',
      generatePracticeErrorFlashcardDraft,
      { pathParameters: { attemptId: ATTEMPT_ID, itemId: ITEM_ID } },
    ],
  ];

  for (const [name, handler, eventOverrides] of cases) {
    it(`${name} declares only one parameter`, () => {
      assert.equal(handler.length, 1);
    });

    it(`${name} does not throw "deps.services is not a function" when called with a second argument`, async () => {
      const event = makeEvent(eventOverrides);
      const fakeLambdaContext = { awsRequestId: 'req-1', functionName: name };
      // Cast away the 1-arg type to faithfully reproduce how the real Lambda
      // runtime calls this function; TypeScript itself already prevents this
      // call shape from compiling, which is part of the fix. DEFAULT_DEPS
      // points at the real composition root, so this will fail for lack of a
      // configured DATABASE_URL in the test environment — that failure is
      // expected and fine; the only thing this guards against is the
      // specific deps-shadowing TypeError.
      const call = handler as unknown as (
        event: APIGatewayProxyEvent,
        context: unknown,
      ) => Promise<APIGatewayProxyResult>;
      try {
        await call(event, fakeLambdaContext);
      } catch (err) {
        assert.ok(
          !(err instanceof TypeError && err.message.includes('deps.services is not a function')),
          `regressed: ${String(err)}`,
        );
      }
    });
  }
});
