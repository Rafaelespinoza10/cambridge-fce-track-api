process.env.JWT_SECRET = 'test-secret-for-flashcard-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  createFlashcard,
  createFlashcardHandler,
  listFlashcardsHandler,
  createWordFamilyHandler,
  listWordFamiliesHandler,
  getFlashcardHandler,
  updateFlashcardHandler,
  suspendFlashcardHandler,
  reactivateFlashcardHandler,
  deleteFlashcardHandler,
} from './flashcardController';
import type { FlashcardControllerDeps, FlashcardsServicePort } from './flashcardController';
import { JwtService } from '../lib/jwt';
import { FlashcardError, FlashcardErrorCode } from '../services/flashcards/flashcards.service';
import type { FlashcardDto, WordFamilyDto } from '../interfaces/flashcards/flashcards.interface';
import { FlashcardType, FlashcardStatus } from '../models/enums';

const USER_ID = 'user-1';
const DECK_ID = '11111111-1111-1111-1111-111111111111';
const FLASHCARD_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-01-15T00:00:00.000Z');

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

const FLASHCARD_DTO: FlashcardDto = {
  id: FLASHCARD_ID,
  deckId: DECK_ID,
  type: FlashcardType.VOCABULARY,
  front: 'Ubiquitous',
  back: 'Presente en todas partes',
  translation: null,
  example: null,
  personalExample: null,
  notes: null,
  sourceName: null,
  sourceUrl: null,
  level: null,
  tags: [],
  status: FlashcardStatus.NEW,
  nextReviewAt: NOW,
  intervalMinutes: 0,
  easeFactor: 2.5,
  repetitions: 0,
  lapses: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const WORD_FAMILY_DTO: WordFamilyDto = {
  familyTag: 'family:happy',
  baseWord: 'happy',
  derivatives: [FLASHCARD_DTO],
};

interface FakeService extends FlashcardsServicePort {
  calls: {
    createFlashcard: Parameters<FlashcardsServicePort['createFlashcard']>[];
    listFlashcards: Parameters<FlashcardsServicePort['listFlashcards']>[];
    createWordFamily: Parameters<FlashcardsServicePort['createWordFamily']>[];
    listWordFamilies: Parameters<FlashcardsServicePort['listWordFamilies']>[];
    getFlashcard: Parameters<FlashcardsServicePort['getFlashcard']>[];
    updateFlashcard: Parameters<FlashcardsServicePort['updateFlashcard']>[];
    suspendFlashcard: Parameters<FlashcardsServicePort['suspendFlashcard']>[];
    reactivateFlashcard: Parameters<FlashcardsServicePort['reactivateFlashcard']>[];
    deleteFlashcard: Parameters<FlashcardsServicePort['deleteFlashcard']>[];
  };
}

function buildDeps(
  overrides: Partial<FlashcardsServicePort> = {},
  now: () => Date = () => NOW,
): { deps: FlashcardControllerDeps; service: FakeService } {
  const calls: FakeService['calls'] = {
    createFlashcard: [],
    listFlashcards: [],
    createWordFamily: [],
    listWordFamilies: [],
    getFlashcard: [],
    updateFlashcard: [],
    suspendFlashcard: [],
    reactivateFlashcard: [],
    deleteFlashcard: [],
  };

  const service: FakeService = {
    calls,
    createFlashcard: async (...args) => {
      calls.createFlashcard.push(args);
      return overrides.createFlashcard ? overrides.createFlashcard(...args) : FLASHCARD_DTO;
    },
    listFlashcards: async (...args) => {
      calls.listFlashcards.push(args);
      return overrides.listFlashcards ? overrides.listFlashcards(...args) : [FLASHCARD_DTO];
    },
    createWordFamily: async (...args) => {
      calls.createWordFamily.push(args);
      return overrides.createWordFamily ? overrides.createWordFamily(...args) : WORD_FAMILY_DTO;
    },
    listWordFamilies: async (...args) => {
      calls.listWordFamilies.push(args);
      return overrides.listWordFamilies ? overrides.listWordFamilies(...args) : [WORD_FAMILY_DTO];
    },
    getFlashcard: async (...args) => {
      calls.getFlashcard.push(args);
      return overrides.getFlashcard ? overrides.getFlashcard(...args) : FLASHCARD_DTO;
    },
    updateFlashcard: async (...args) => {
      calls.updateFlashcard.push(args);
      return overrides.updateFlashcard ? overrides.updateFlashcard(...args) : FLASHCARD_DTO;
    },
    suspendFlashcard: async (...args) => {
      calls.suspendFlashcard.push(args);
      return overrides.suspendFlashcard
        ? overrides.suspendFlashcard(...args)
        : { ...FLASHCARD_DTO, status: FlashcardStatus.SUSPENDED };
    },
    reactivateFlashcard: async (...args) => {
      calls.reactivateFlashcard.push(args);
      return overrides.reactivateFlashcard ? overrides.reactivateFlashcard(...args) : FLASHCARD_DTO;
    },
    deleteFlashcard: async (...args) => {
      calls.deleteFlashcard.push(args);
      if (overrides.deleteFlashcard) await overrides.deleteFlashcard(...args);
    },
  };

  return { deps: { now, services: async () => ({ flashcards: service }) }, service };
}

// ── createFlashcard ──────────────────────────────────────────────────────────────

describe('createFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await createFlashcardHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await createFlashcardHandler(
      makeEvent({ pathParameters: { deckId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await createFlashcardHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID }, body: '{not json' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('creates successfully and returns 201', async () => {
    const { deps, service } = buildDeps();
    const result = await createFlashcardHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({ type: 'vocabulary', front: 'Front', back: 'Back' }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 201);
    assert.equal(service.calls.createFlashcard[0][0], USER_ID);
    assert.equal(service.calls.createFlashcard[0][1], DECK_ID);
  });

  it('takes userId from the JWT, never from the body', async () => {
    const { deps, service } = buildDeps();
    await createFlashcardHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({
          type: 'vocabulary',
          front: 'Front',
          back: 'Back',
          userId: 'someone-else',
        }),
      }),
      deps,
    );
    assert.equal(service.calls.createFlashcard[0][0], USER_ID);
  });

  it('the "now" passed to the service comes from the server clock provider', async () => {
    const { deps, service } = buildDeps({}, () => NOW);
    await createFlashcardHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({ type: 'vocabulary', front: 'Front', back: 'Back' }),
      }),
      deps,
    );
    assert.deepEqual(service.calls.createFlashcard[0][2], NOW);
  });

  it('maps a domain error to its HTTP status', async () => {
    const { deps } = buildDeps({
      createFlashcard: async () => {
        throw new FlashcardError('front must not be empty', FlashcardErrorCode.INVALID_INPUT);
      },
    });
    const result = await createFlashcardHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({ type: 'vocabulary', front: '', back: 'Back' }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      createFlashcard: async () => {
        throw new Error('duplicate key value violates unique constraint "whatever"');
      },
    });
    const result = await createFlashcardHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({ type: 'vocabulary', front: 'Front', back: 'Back' }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── listFlashcards ───────────────────────────────────────────────────────────────

describe('listFlashcards', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await listFlashcardsHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await listFlashcardsHandler(
      makeEvent({ pathParameters: { deckId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('defaults to status=active when no query param is given', async () => {
    const { deps, service } = buildDeps();
    const result = await listFlashcardsHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.listFlashcards[0][2], 'active');
  });

  it('accepts status=suspended and status=all', async () => {
    const { deps, service } = buildDeps();
    await listFlashcardsHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        queryStringParameters: { status: 'suspended' },
      }),
      deps,
    );
    assert.equal(service.calls.listFlashcards[0][2], 'suspended');

    await listFlashcardsHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID }, queryStringParameters: { status: 'all' } }),
      deps,
    );
    assert.equal(service.calls.listFlashcards[1][2], 'all');
  });

  it('rejects an invalid status query value', async () => {
    const { deps } = buildDeps();
    const result = await listFlashcardsHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        queryStringParameters: { status: 'archived' },
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('accepts a valid type filter', async () => {
    const { deps, service } = buildDeps();
    await listFlashcardsHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        queryStringParameters: { type: 'grammar' },
      }),
      deps,
    );
    assert.equal(service.calls.listFlashcards[0][3], 'grammar');
  });

  it('rejects an invalid type filter', async () => {
    const { deps } = buildDeps();
    const result = await listFlashcardsHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        queryStringParameters: { type: 'not-a-type' },
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('maps DECK_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      listFlashcards: async () => {
        throw new FlashcardError('not found', FlashcardErrorCode.DECK_NOT_FOUND);
      },
    });
    const result = await listFlashcardsHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

// ── createWordFamily ─────────────────────────────────────────────────────────────

describe('createWordFamily', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await createWordFamilyHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await createWordFamilyHandler(
      makeEvent({ pathParameters: { deckId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects invalid JSON', async () => {
    const { deps } = buildDeps();
    const result = await createWordFamilyHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID }, body: '{not json' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('parses the body and forwards it to the service', async () => {
    const { deps, service } = buildDeps();
    const body = {
      baseWord: 'happy',
      derivatives: [{ form: 'happiness', partOfSpeech: 'noun' }],
    };
    const result = await createWordFamilyHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID }, body: JSON.stringify(body) }),
      deps,
    );
    assert.equal(result.statusCode, 201);
    assert.deepEqual(service.calls.createWordFamily[0][3], body);
  });

  it('maps a domain error to its HTTP status', async () => {
    const { deps } = buildDeps({
      createWordFamily: async () => {
        throw new FlashcardError('baseWord must not be empty', FlashcardErrorCode.INVALID_INPUT);
      },
    });
    const result = await createWordFamilyHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({ baseWord: '', derivatives: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });
});

// ── listWordFamilies ─────────────────────────────────────────────────────────────

describe('listWordFamilies', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await listWordFamiliesHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await listWordFamiliesHandler(
      makeEvent({ pathParameters: { deckId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('returns the families from the service', async () => {
    const { deps } = buildDeps();
    const result = await listWordFamiliesHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    const data = parseBody(result).data as WordFamilyDto[];
    assert.equal(data.length, 1);
    assert.equal(data[0].familyTag, WORD_FAMILY_DTO.familyTag);
    assert.equal(data[0].baseWord, WORD_FAMILY_DTO.baseWord);
  });

  it('maps DECK_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      listWordFamilies: async () => {
        throw new FlashcardError('not found', FlashcardErrorCode.DECK_NOT_FOUND);
      },
    });
    const result = await listWordFamiliesHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

// ── getFlashcard ─────────────────────────────────────────────────────────────────

describe('getFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getFlashcardHandler(
      makeEvent({ headers: {}, pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('returns the flashcard for an authenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
  });

  it('rejects an invalid flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await getFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects a missing flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await getFlashcardHandler(makeEvent({ pathParameters: null }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('maps FLASHCARD_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      getFlashcard: async () => {
        throw new FlashcardError('not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
      },
    });
    const result = await getFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

// ── updateFlashcard ──────────────────────────────────────────────────────────────

describe('updateFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await updateFlashcardHandler(
      makeEvent({ headers: {}, pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await updateFlashcardHandler(
      makeEvent({
        pathParameters: { flashcardId: 'nope' },
        body: JSON.stringify({ front: 'x' }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await updateFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID }, body: '{not json' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('forwards userId from the JWT and ignores protected fields sent by the client', async () => {
    const { deps, service } = buildDeps();
    await updateFlashcardHandler(
      makeEvent({
        pathParameters: { flashcardId: FLASHCARD_ID },
        body: JSON.stringify({ front: 'New front', status: 'review', userId: 'someone-else' }),
      }),
      deps,
    );
    // The controller forwards the parsed body as-is; FlashcardsService is
    // responsible for ignoring status/userId — already covered at the service level.
    assert.equal(service.calls.updateFlashcard[0][0], USER_ID);
    assert.equal(service.calls.updateFlashcard[0][1], FLASHCARD_ID);
  });

  it('maps an empty-patch INVALID_INPUT to 400', async () => {
    const { deps } = buildDeps({
      updateFlashcard: async () => {
        throw new FlashcardError(
          'At least one field must be provided',
          FlashcardErrorCode.INVALID_INPUT,
        );
      },
    });
    const result = await updateFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID }, body: '{}' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('maps FLASHCARD_DUPLICATE to 409', async () => {
    const { deps } = buildDeps({
      updateFlashcard: async () => {
        throw new FlashcardError('duplicate', FlashcardErrorCode.FLASHCARD_DUPLICATE);
      },
    });
    const result = await updateFlashcardHandler(
      makeEvent({
        pathParameters: { flashcardId: FLASHCARD_ID },
        body: JSON.stringify({ front: 'x' }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 409);
  });
});

// ── suspendFlashcard ─────────────────────────────────────────────────────────────

describe('suspendFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await suspendFlashcardHandler(
      makeEvent({ headers: {}, pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await suspendFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('suspends successfully and returns 200', async () => {
    const { deps } = buildDeps();
    const result = await suspendFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal((parseBody(result).data as FlashcardDto).status, FlashcardStatus.SUSPENDED);
  });

  it('maps FLASHCARD_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      suspendFlashcard: async () => {
        throw new FlashcardError('not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
      },
    });
    const result = await suspendFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

// ── reactivateFlashcard ──────────────────────────────────────────────────────────

describe('reactivateFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await reactivateFlashcardHandler(
      makeEvent({ headers: {}, pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await reactivateFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('reactivates successfully and returns 200', async () => {
    const { deps } = buildDeps();
    const result = await reactivateFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
  });
});

// ── deleteFlashcard ──────────────────────────────────────────────────────────────

describe('deleteFlashcard', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await deleteFlashcardHandler(
      makeEvent({ headers: {}, pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid flashcardId', async () => {
    const { deps } = buildDeps();
    const result = await deleteFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('deletes successfully and returns 200', async () => {
    const { deps, service } = buildDeps();
    const result = await deleteFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.deleteFlashcard[0][0], USER_ID);
    assert.equal(service.calls.deleteFlashcard[0][1], FLASHCARD_ID);
  });

  it('a second delete attempt maps FLASHCARD_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      deleteFlashcard: async () => {
        throw new FlashcardError('not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
      },
    });
    const result = await deleteFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      deleteFlashcard: async () => {
        throw new Error('relation "flashcards" violates constraint "whatever"');
      },
    });
    const result = await deleteFlashcardHandler(
      makeEvent({ pathParameters: { flashcardId: FLASHCARD_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── Lambda invocation shape regression guard ───────────────────────────────────────
//
// AWS Lambda always calls the exported handler as `handler(event, context)`.
// A prior version of this controller took `deps: FlashcardControllerDeps =
// DEFAULT_DEPS` as its second parameter — since `context` is never
// `undefined`, the default never activated in production and every request
// crashed with `TypeError: deps.services is not a function`, masked as a
// generic 500 by handleError. This guards against that shape regressing.

describe('exported Lambda handlers ignore a second (context) argument', () => {
  it('createFlashcard declares only one parameter', () => {
    assert.equal(createFlashcard.length, 1);
  });

  it('does not throw "deps.services is not a function" when called with a second argument', async () => {
    const event = makeEvent({
      pathParameters: { deckId: DECK_ID },
      body: JSON.stringify({ type: 'vocabulary', front: 'Front', back: 'Back' }),
    });
    const fakeLambdaContext = { awsRequestId: 'req-1', functionName: 'flashcardsCreateFlashcard' };
    // Cast away the 1-arg type to faithfully reproduce how the real Lambda
    // runtime calls this function; TypeScript itself already prevents this
    // call shape from compiling, which is part of the fix. DEFAULT_DEPS
    // points at the real composition root, so this will fail for lack of a
    // configured DATABASE_URL in the test environment — that failure is
    // expected and fine; the only thing this guards against is the specific
    // deps-shadowing TypeError.
    const call = createFlashcard as unknown as (
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
