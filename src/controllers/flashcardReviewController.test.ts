process.env.JWT_SECRET = 'test-secret-for-flashcard-review-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  startFlashcardReviewSession,
  answerFlashcard,
  completeFlashcardReviewSession,
} from './flashcardReviewController';
import type {
  FlashcardReviewControllerDeps,
  StartSessionPort,
  AnswerFlashcardPort,
  CompleteSessionPort,
} from './flashcardReviewController';
import { JwtService } from '../lib/jwt';
import { ReviewRating, StudySessionStatus, FlashcardStatus } from '../models/enums';
import {
  FlashcardReviewError,
  FlashcardReviewErrorCode,
} from '../services/flashcard-review.service';
import {
  StartFlashcardReviewSessionError,
  StartFlashcardReviewSessionErrorCode,
} from '../services/start-flashcard-review-session.service';
import {
  CompleteFlashcardReviewSessionError,
  CompleteFlashcardReviewSessionErrorCode,
} from '../services/complete-flashcard-review-session.service';
import type { StartFlashcardReviewSessionResult } from '../interfaces/start-flashcard-review-session.interface';
import type { AnswerFlashcardResult } from '../interfaces/flashcard-review.interface';
import type { CompleteFlashcardReviewSessionResult } from '../interfaces/complete-flashcard-review-session.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const FLASHCARD_ID = '22222222-2222-2222-2222-222222222222';
const IDEMPOTENCY_KEY = '33333333-3333-3333-3333-333333333333';
const DECK_ID = '44444444-4444-4444-4444-444444444444';
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

const START_RESULT: StartFlashcardReviewSessionResult = {
  studySessionId: SESSION_ID,
  sessionResumed: false,
  sessionStartedAt: FIXED_NOW,
  timezone: 'UTC',
  localDate: '2026-01-15',
  dayStartedAt: new Date('2026-01-15T00:00:00.000Z'),
  dayEndedAt: new Date('2026-01-16T00:00:00.000Z'),
  dailyGoal: 10,
  dailyProgress: {
    cardsReviewed: 0,
    uniqueCardsReviewed: 0,
    requiredReviews: 8,
    cardsDueAtFirstSession: 8,
    goalCompleted: false,
  },
  queue: { cards: [], cardsDue: 0 },
};

const ANSWER_RESULT: AnswerFlashcardResult = {
  reviewId: 'review-1',
  idempotentReplay: false,
  scheduling: {
    previousStatus: FlashcardStatus.REVIEW,
    newStatus: FlashcardStatus.REVIEW,
    previousNextReviewAt: new Date('2026-01-14T00:00:00.000Z'),
    newNextReviewAt: new Date('2026-01-20T00:00:00.000Z'),
    previousIntervalMinutes: 1440,
    newIntervalMinutes: 8640,
    previousEaseFactor: 2.5,
    newEaseFactor: 2.5,
    previousRepetitions: 3,
    newRepetitions: 4,
    previousLapses: 0,
    newLapses: 0,
  },
  dailyProgress: {
    cardsReviewed: 1,
    uniqueCardsReviewed: 1,
    requiredReviews: 8,
    goalCompleted: false,
  },
  sessionProgress: { reviewsCount: 1 },
};

const COMPLETE_RESULT: CompleteFlashcardReviewSessionResult = {
  session: {
    id: SESSION_ID,
    status: StudySessionStatus.COMPLETED,
    startedAt: new Date('2026-01-15T14:00:00.000Z'),
    endedAt: FIXED_NOW,
    durationMinutes: 30,
  },
  summary: { reviewsCount: 3 },
  idempotentReplay: false,
};

interface FakePorts {
  startSession: StartSessionPort & { calls: Parameters<StartSessionPort['execute']>[0][] };
  answerFlashcard: AnswerFlashcardPort & { calls: Parameters<AnswerFlashcardPort['execute']>[0][] };
  completeSession: CompleteSessionPort & { calls: Parameters<CompleteSessionPort['execute']>[0][] };
}

function buildDeps(
  overrides: {
    startExecute?: StartSessionPort['execute'];
    answerExecute?: AnswerFlashcardPort['execute'];
    completeExecute?: CompleteSessionPort['execute'];
  } = {},
): { deps: FlashcardReviewControllerDeps; ports: FakePorts } {
  const startCalls: Parameters<StartSessionPort['execute']>[0][] = [];
  const answerCalls: Parameters<AnswerFlashcardPort['execute']>[0][] = [];
  const completeCalls: Parameters<CompleteSessionPort['execute']>[0][] = [];

  const ports: FakePorts = {
    startSession: {
      calls: startCalls,
      execute: async (input) => {
        startCalls.push(input);
        return overrides.startExecute ? overrides.startExecute(input) : START_RESULT;
      },
    },
    answerFlashcard: {
      calls: answerCalls,
      execute: async (input) => {
        answerCalls.push(input);
        return overrides.answerExecute ? overrides.answerExecute(input) : ANSWER_RESULT;
      },
    },
    completeSession: {
      calls: completeCalls,
      execute: async (input) => {
        completeCalls.push(input);
        return overrides.completeExecute ? overrides.completeExecute(input) : COMPLETE_RESULT;
      },
    },
  };

  const deps: FlashcardReviewControllerDeps = {
    now: () => FIXED_NOW,
    services: async () => ports,
  };

  return { deps, ports };
}

// ── startFlashcardReviewSession ────────────────────────────────────────────────────

describe('startFlashcardReviewSession', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await startFlashcardReviewSession(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('accepts a valid empty body', async () => {
    const { deps } = buildDeps();
    const result = await startFlashcardReviewSession(makeEvent({ body: null }), deps);
    assert.equal(result.statusCode, 201);
  });

  it('accepts a valid deckId', async () => {
    const { deps, ports } = buildDeps();
    const result = await startFlashcardReviewSession(
      makeEvent({ body: JSON.stringify({ deckId: DECK_ID }) }),
      deps,
    );
    assert.equal(result.statusCode, 201);
    assert.equal(ports.startSession.calls[0].deckId, DECK_ID);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await startFlashcardReviewSession(
      makeEvent({ body: JSON.stringify({ deckId: 'not-a-uuid' }) }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await startFlashcardReviewSession(makeEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('returns 201 when the service creates a new session', async () => {
    const { deps } = buildDeps({
      startExecute: async () => ({ ...START_RESULT, sessionResumed: false }),
    });
    const result = await startFlashcardReviewSession(makeEvent(), deps);
    assert.equal(result.statusCode, 201);
    const body = parseBody(result);
    assert.equal((body.data as { session: { resumed: boolean } }).session.resumed, false);
  });

  it('returns 200 when the service resumes an existing session', async () => {
    const { deps } = buildDeps({
      startExecute: async () => ({ ...START_RESULT, sessionResumed: true }),
    });
    const result = await startFlashcardReviewSession(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal((body.data as { session: { resumed: boolean } }).session.resumed, true);
  });

  it('takes userId from the JWT, never from the body', async () => {
    const { deps, ports } = buildDeps();
    await startFlashcardReviewSession(
      makeEvent({ body: JSON.stringify({ userId: 'someone-else', deckId: DECK_ID }) }),
      deps,
    );
    assert.equal(ports.startSession.calls[0].userId, USER_ID);
  });

  it('takes requestedAt from the server clock, and ignores a client-supplied timezone', async () => {
    const { deps, ports } = buildDeps();
    await startFlashcardReviewSession(
      makeEvent({
        body: JSON.stringify({ timezone: 'Europe/Madrid', requestedAt: '2000-01-01T00:00:00Z' }),
      }),
      deps,
    );
    const call = ports.startSession.calls[0];
    assert.equal(call.requestedAt.getTime(), FIXED_NOW.getTime());
    assert.deepEqual(Object.keys(call).sort(), ['deckId', 'requestedAt', 'userId']);
  });

  it('maps a domain error to its HTTP status', async () => {
    const { deps } = buildDeps({
      startExecute: async () => {
        throw new StartFlashcardReviewSessionError(
          'Deck not found',
          StartFlashcardReviewSessionErrorCode.DECK_UNAVAILABLE,
        );
      },
    });
    const result = await startFlashcardReviewSession(
      makeEvent({ body: JSON.stringify({ deckId: DECK_ID }) }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

// ── answerFlashcard ─────────────────────────────────────────────────────────────────

function answerEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return makeEvent({
    pathParameters: { sessionId: SESSION_ID },
    body: JSON.stringify({
      flashcardId: FLASHCARD_ID,
      rating: ReviewRating.GOOD,
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    ...overrides,
  });
}

describe('answerFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(answerEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid sessionId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(
      answerEvent({ pathParameters: { sessionId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects an invalid flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(
      answerEvent({
        body: JSON.stringify({
          flashcardId: 'nope',
          rating: 'good',
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects an invalid idempotencyKey', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(
      answerEvent({
        body: JSON.stringify({ flashcardId: FLASHCARD_ID, rating: 'good', idempotencyKey: 'nope' }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects an invalid rating', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(
      answerEvent({
        body: JSON.stringify({
          flashcardId: FLASHCARD_ID,
          rating: 'excellent',
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects a negative responseTimeMs', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(
      answerEvent({
        body: JSON.stringify({
          flashcardId: FLASHCARD_ID,
          rating: 'good',
          idempotencyKey: IDEMPOTENCY_KEY,
          responseTimeMs: -5,
        }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects a decimal responseTimeMs', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(
      answerEvent({
        body: JSON.stringify({
          flashcardId: FLASHCARD_ID,
          rating: 'good',
          idempotencyKey: IDEMPOTENCY_KEY,
          responseTimeMs: 2.5,
        }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await answerFlashcard(answerEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('takes reviewedAt from the server clock and calls the use case exactly once', async () => {
    const { deps, ports } = buildDeps();
    const result = await answerFlashcard(answerEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.equal(ports.answerFlashcard.calls.length, 1);
    assert.equal(ports.answerFlashcard.calls[0].reviewedAt.getTime(), FIXED_NOW.getTime());
    assert.equal(ports.answerFlashcard.calls[0].userId, USER_ID);
    assert.equal(ports.answerFlashcard.calls[0].studySessionId, SESSION_ID);
  });

  it('an idempotent replay still returns 200', async () => {
    const { deps } = buildDeps({
      answerExecute: async () => ({ ...ANSWER_RESULT, idempotentReplay: true }),
    });
    const result = await answerFlashcard(answerEvent(), deps);
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal((body.data as { idempotentReplay: boolean }).idempotentReplay, true);
  });

  it('maps a flashcard/session domain error to its HTTP status', async () => {
    const { deps } = buildDeps({
      answerExecute: async () => {
        throw new FlashcardReviewError(
          'Flashcard is suspended',
          FlashcardReviewErrorCode.FLASHCARD_SUSPENDED,
        );
      },
    });
    const result = await answerFlashcard(answerEvent(), deps);
    assert.equal(result.statusCode, 409);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      answerExecute: async () => {
        throw new Error(
          'duplicate key value violates unique constraint "uq_flashcard_reviews_idempotency"',
        );
      },
    });
    const result = await answerFlashcard(answerEvent(), deps);
    assert.equal(result.statusCode, 500);
    const body = parseBody(result);
    assert.equal(body.message, 'Internal server error');
  });
});

// ── completeFlashcardReviewSession ──────────────────────────────────────────────────

function completeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return makeEvent({ pathParameters: { sessionId: SESSION_ID }, body: null, ...overrides });
}

describe('completeFlashcardReviewSession', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await completeFlashcardReviewSession(completeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid sessionId path parameter', async () => {
    const { deps } = buildDeps();
    const result = await completeFlashcardReviewSession(
      completeEvent({ pathParameters: { sessionId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('tolerates an empty body', async () => {
    const { deps } = buildDeps();
    const result = await completeFlashcardReviewSession(completeEvent({ body: null }), deps);
    assert.equal(result.statusCode, 200);
  });

  it('rejects malformed JSON when a body is actually sent', async () => {
    const { deps } = buildDeps();
    const result = await completeFlashcardReviewSession(completeEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('takes completedAt from the server clock and ignores a client-supplied duration', async () => {
    const { deps, ports } = buildDeps();
    await completeFlashcardReviewSession(
      completeEvent({
        body: JSON.stringify({ durationMinutes: 999, completedAt: '2000-01-01T00:00:00Z' }),
      }),
      deps,
    );
    const call = ports.completeSession.calls[0];
    assert.equal(call.completedAt.getTime(), FIXED_NOW.getTime());
    assert.deepEqual(Object.keys(call).sort(), ['completedAt', 'studySessionId', 'userId']);
  });

  it('closes successfully', async () => {
    const { deps } = buildDeps();
    const result = await completeFlashcardReviewSession(completeEvent(), deps);
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal((body.data as { idempotentReplay: boolean }).idempotentReplay, false);
  });

  it('an idempotent replay still returns 200', async () => {
    const { deps } = buildDeps({
      completeExecute: async () => ({ ...COMPLETE_RESULT, idempotentReplay: true }),
    });
    const result = await completeFlashcardReviewSession(completeEvent(), deps);
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal((body.data as { idempotentReplay: boolean }).idempotentReplay, true);
  });

  it('maps a session-not-found error to 404', async () => {
    const { deps } = buildDeps({
      completeExecute: async () => {
        throw new CompleteFlashcardReviewSessionError(
          'Study session not found',
          CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND,
        );
      },
    });
    const result = await completeFlashcardReviewSession(completeEvent(), deps);
    assert.equal(result.statusCode, 404);
  });

  it('maps a temporal-order conflict to 409', async () => {
    const { deps } = buildDeps({
      completeExecute: async () => {
        throw new CompleteFlashcardReviewSessionError(
          'completedAt is before the session started_at',
          CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_SESSION_START,
        );
      },
    });
    const result = await completeFlashcardReviewSession(completeEvent(), deps);
    assert.equal(result.statusCode, 409);
  });

  it('maps a persistence inconsistency to 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      completeExecute: async () => {
        throw new CompleteFlashcardReviewSessionError(
          'Completed flashcard review session is missing started_at/ended_at/duration_minutes',
          CompleteFlashcardReviewSessionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      },
    });
    const result = await completeFlashcardReviewSession(completeEvent(), deps);
    assert.equal(result.statusCode, 500);
    const body = parseBody(result);
    assert.equal(body.message, 'Internal server error');
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      completeExecute: async () => {
        throw new Error('relation "study_sessions" violates constraint "chk_whatever"');
      },
    });
    const result = await completeFlashcardReviewSession(completeEvent(), deps);
    assert.equal(result.statusCode, 500);
    const body = parseBody(result);
    assert.equal(body.message, 'Internal server error');
  });
});
