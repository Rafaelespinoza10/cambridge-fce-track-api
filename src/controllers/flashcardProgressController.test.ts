process.env.JWT_SECRET = 'test-secret-for-flashcard-progress-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  getFlashcardPreferences,
  getFlashcardPreferencesHandler,
  updateFlashcardPreferencesHandler,
  getFlashcardReviewSummaryHandler,
} from './flashcardProgressController';
import type {
  FlashcardProgressControllerDeps,
  FlashcardProgressServicePort,
} from './flashcardProgressController';
import { JwtService } from '@lib/shared/jwt';
import {
  FlashcardProgressError,
  FlashcardProgressErrorCode,
} from '../services/flashcards/flashcard-progress.service';
import type {
  FlashcardPreferencesDto,
  FlashcardReviewSummaryDto,
} from '../interfaces/flashcards/flashcard-progress.interface';

const USER_ID = 'user-1';
const NOW = new Date('2026-01-15T14:30:00.000Z');

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

const PREFERENCES_DTO: FlashcardPreferencesDto = { dailyGoal: 10 };

const SUMMARY_DTO: FlashcardReviewSummaryDto = {
  preferences: { dailyGoal: 10 },
  day: {
    initialized: false,
    localDate: '2026-01-15',
    timezone: 'UTC',
    cardsDueNow: 0,
    dailyGoal: 10,
    cardsDueAtFirstSession: null,
    requiredReviews: null,
    cardsReviewed: 0,
    uniqueCardsReviewed: 0,
    goalCompleted: false,
  },
  streak: { current: 0, best: 0 },
  week: [],
};

interface FakeService extends FlashcardProgressServicePort {
  calls: {
    getPreferences: Parameters<FlashcardProgressServicePort['getPreferences']>[];
    updatePreferences: Parameters<FlashcardProgressServicePort['updatePreferences']>[];
    getReviewSummary: Parameters<FlashcardProgressServicePort['getReviewSummary']>[];
  };
}

function buildDeps(
  overrides: Partial<FlashcardProgressServicePort> = {},
  now: () => Date = () => NOW,
): { deps: FlashcardProgressControllerDeps; service: FakeService } {
  const calls: FakeService['calls'] = {
    getPreferences: [],
    updatePreferences: [],
    getReviewSummary: [],
  };

  const service: FakeService = {
    calls,
    getPreferences: async (...args) => {
      calls.getPreferences.push(args);
      return overrides.getPreferences ? overrides.getPreferences(...args) : PREFERENCES_DTO;
    },
    updatePreferences: async (...args) => {
      calls.updatePreferences.push(args);
      return overrides.updatePreferences ? overrides.updatePreferences(...args) : PREFERENCES_DTO;
    },
    getReviewSummary: async (...args) => {
      calls.getReviewSummary.push(args);
      return overrides.getReviewSummary ? overrides.getReviewSummary(...args) : SUMMARY_DTO;
    },
  };

  return { deps: { now, services: async () => ({ progress: service }) }, service };
}

// ── getFlashcardPreferences ──────────────────────────────────────────────────────

describe('getFlashcardPreferences', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getFlashcardPreferencesHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('returns preferences for the authenticated user', async () => {
    const { deps, service } = buildDeps();
    const result = await getFlashcardPreferencesHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.getPreferences[0]![0], USER_ID);
    assert.deepEqual(parseBody(result).data, PREFERENCES_DTO);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      getPreferences: async () => {
        throw new Error('relation "flashcard_preferences" does not exist');
      },
    });
    const result = await getFlashcardPreferencesHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── updateFlashcardPreferences ───────────────────────────────────────────────────

describe('updateFlashcardPreferences', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await updateFlashcardPreferencesHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await updateFlashcardPreferencesHandler(makeEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('updates successfully and returns 200', async () => {
    const { deps, service } = buildDeps();
    const result = await updateFlashcardPreferencesHandler(
      makeEvent({ body: JSON.stringify({ dailyGoal: 20 }) }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.updatePreferences[0]![0], USER_ID);
  });

  it('takes userId from the JWT, never from the body', async () => {
    const { deps, service } = buildDeps();
    await updateFlashcardPreferencesHandler(
      makeEvent({ body: JSON.stringify({ dailyGoal: 20, userId: 'someone-else' }) }),
      deps,
    );
    assert.equal(service.calls.updatePreferences[0]![0], USER_ID);
  });

  it('maps an invalid dailyGoal domain error to 400', async () => {
    const { deps } = buildDeps({
      updatePreferences: async () => {
        throw new FlashcardProgressError(
          'dailyGoal must be greater than zero',
          FlashcardProgressErrorCode.INVALID_INPUT,
        );
      },
    });
    const result = await updateFlashcardPreferencesHandler(
      makeEvent({ body: JSON.stringify({ dailyGoal: 0 }) }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('maps PREFERENCES_UPDATE_CONFLICT to 409', async () => {
    const { deps } = buildDeps({
      updatePreferences: async () => {
        throw new FlashcardProgressError(
          'conflict',
          FlashcardProgressErrorCode.PREFERENCES_UPDATE_CONFLICT,
        );
      },
    });
    const result = await updateFlashcardPreferencesHandler(
      makeEvent({ body: JSON.stringify({ dailyGoal: 20 }) }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      updatePreferences: async () => {
        throw new Error('duplicate key value violates unique constraint "whatever"');
      },
    });
    const result = await updateFlashcardPreferencesHandler(
      makeEvent({ body: JSON.stringify({ dailyGoal: 20 }) }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── getFlashcardReviewSummary ─────────────────────────────────────────────────────

describe('getFlashcardReviewSummary', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getFlashcardReviewSummaryHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('returns the summary for the authenticated user', async () => {
    const { deps, service } = buildDeps();
    const result = await getFlashcardReviewSummaryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.getReviewSummary[0]![0], USER_ID);
    assert.deepEqual(parseBody(result).data, SUMMARY_DTO);
  });

  it('the "now" passed to the service comes from the server clock provider', async () => {
    const { deps, service } = buildDeps({}, () => NOW);
    await getFlashcardReviewSummaryHandler(makeEvent(), deps);
    assert.deepEqual(service.calls.getReviewSummary[0]![1], NOW);
  });

  it('ignores any date/timezone the client tries to inject via query params', async () => {
    const { deps, service } = buildDeps({}, () => NOW);
    await getFlashcardReviewSummaryHandler(
      makeEvent({
        queryStringParameters: { now: '2020-01-01T00:00:00.000Z', timezone: 'Antarctica/Troll' },
      }),
      deps,
    );
    assert.deepEqual(service.calls.getReviewSummary[0]![1], NOW);
  });

  it('maps USER_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      getReviewSummary: async () => {
        throw new FlashcardProgressError('not found', FlashcardProgressErrorCode.USER_NOT_FOUND);
      },
    });
    const result = await getFlashcardReviewSummaryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 404);
  });

  it('maps INVALID_TIMEZONE to 400', async () => {
    const { deps } = buildDeps({
      getReviewSummary: async () => {
        throw new FlashcardProgressError(
          'bad timezone',
          FlashcardProgressErrorCode.INVALID_TIMEZONE,
        );
      },
    });
    const result = await getFlashcardReviewSummaryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 400);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      getReviewSummary: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    });
    const result = await getFlashcardReviewSummaryHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── Lambda invocation shape regression guard ───────────────────────────────────────
//
// AWS Lambda always calls the exported handler as `handler(event, context)`.
// A prior version of this controller took `deps:
// FlashcardProgressControllerDeps = DEFAULT_DEPS` as its second parameter —
// since `context` is never `undefined`, the default never activated in
// production and every request crashed with `TypeError: deps.services is not
// a function`, masked as a generic 500 by handleError. This guards against
// that shape regressing.

describe('exported Lambda handlers ignore a second (context) argument', () => {
  it('getFlashcardPreferences declares only one parameter', () => {
    assert.equal(getFlashcardPreferences.length, 1);
  });

  it('does not throw "deps.services is not a function" when called with a second argument', async () => {
    const event = makeEvent();
    const fakeLambdaContext = { awsRequestId: 'req-1', functionName: 'flashcardsGetPreferences' };
    // Cast away the 1-arg type to faithfully reproduce how the real Lambda
    // runtime calls this function; TypeScript itself already prevents this
    // call shape from compiling, which is part of the fix. DEFAULT_DEPS
    // points at the real composition root, so this will fail for lack of a
    // configured DATABASE_URL in the test environment — that failure is
    // expected and fine; the only thing this guards against is the specific
    // deps-shadowing TypeError.
    const call = getFlashcardPreferences as unknown as (
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
});
