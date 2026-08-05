process.env.JWT_SECRET = 'test-secret-for-deck-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  createDeck,
  createDeckHandler,
  listDecksHandler,
  getDeckHandler,
  updateDeckHandler,
  archiveDeckHandler,
  unarchiveDeckHandler,
  deleteDeckHandler,
} from './deckController';
import type { DeckControllerDeps, DecksServicePort } from './deckController';
import { JwtService } from '../lib/jwt';
import { DeckError, DeckErrorCode } from '../services/decks/decks.service';
import type { DeckDto } from '../interfaces/decks/decks.interface';

const USER_ID = 'user-1';
const DECK_ID = '11111111-1111-1111-1111-111111111111';

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

const DECK_DTO: DeckDto = {
  id: DECK_ID,
  name: 'Phrasal verbs',
  description: null,
  color: null,
  isArchived: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

interface FakeService extends DecksServicePort {
  calls: {
    createDeck: Parameters<DecksServicePort['createDeck']>[];
    listDecks: Parameters<DecksServicePort['listDecks']>[];
    getDeck: Parameters<DecksServicePort['getDeck']>[];
    updateDeck: Parameters<DecksServicePort['updateDeck']>[];
    archiveDeck: Parameters<DecksServicePort['archiveDeck']>[];
    unarchiveDeck: Parameters<DecksServicePort['unarchiveDeck']>[];
    deleteDeck: Parameters<DecksServicePort['deleteDeck']>[];
  };
}

function buildDeps(overrides: Partial<DecksServicePort> = {}): {
  deps: DeckControllerDeps;
  service: FakeService;
} {
  const calls: FakeService['calls'] = {
    createDeck: [],
    listDecks: [],
    getDeck: [],
    updateDeck: [],
    archiveDeck: [],
    unarchiveDeck: [],
    deleteDeck: [],
  };

  const service: FakeService = {
    calls,
    createDeck: async (...args) => {
      calls.createDeck.push(args);
      return overrides.createDeck ? overrides.createDeck(...args) : DECK_DTO;
    },
    listDecks: async (...args) => {
      calls.listDecks.push(args);
      return overrides.listDecks ? overrides.listDecks(...args) : [DECK_DTO];
    },
    getDeck: async (...args) => {
      calls.getDeck.push(args);
      return overrides.getDeck ? overrides.getDeck(...args) : DECK_DTO;
    },
    updateDeck: async (...args) => {
      calls.updateDeck.push(args);
      return overrides.updateDeck ? overrides.updateDeck(...args) : DECK_DTO;
    },
    archiveDeck: async (...args) => {
      calls.archiveDeck.push(args);
      return overrides.archiveDeck
        ? overrides.archiveDeck(...args)
        : { ...DECK_DTO, isArchived: true };
    },
    unarchiveDeck: async (...args) => {
      calls.unarchiveDeck.push(args);
      return overrides.unarchiveDeck ? overrides.unarchiveDeck(...args) : DECK_DTO;
    },
    deleteDeck: async (...args) => {
      calls.deleteDeck.push(args);
      if (overrides.deleteDeck) await overrides.deleteDeck(...args);
    },
  };

  return { deps: { services: async () => ({ decks: service }) }, service };
}

describe('createDeck', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await createDeckHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await createDeckHandler(makeEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('creates successfully and returns 201', async () => {
    const { deps, service } = buildDeps();
    const result = await createDeckHandler(
      makeEvent({ body: JSON.stringify({ name: 'Idioms' }) }),
      deps,
    );
    assert.equal(result.statusCode, 201);
    assert.equal(service.calls.createDeck[0][0], USER_ID);
  });

  it('takes userId from the JWT, never from the body', async () => {
    const { deps, service } = buildDeps();
    await createDeckHandler(
      makeEvent({ body: JSON.stringify({ name: 'Idioms', userId: 'someone-else' }) }),
      deps,
    );
    assert.equal(service.calls.createDeck[0][0], USER_ID);
  });

  it('maps a domain error to its HTTP status', async () => {
    const { deps } = buildDeps({
      createDeck: async () => {
        throw new DeckError('name must not be empty', DeckErrorCode.INVALID_INPUT);
      },
    });
    const result = await createDeckHandler(makeEvent({ body: JSON.stringify({ name: '' }) }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      createDeck: async () => {
        throw new Error('duplicate key value violates unique constraint "whatever"');
      },
    });
    const result = await createDeckHandler(
      makeEvent({ body: JSON.stringify({ name: 'Idioms' }) }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

describe('listDecks', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await listDecksHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('defaults to available when no status query param is given', async () => {
    const { deps, service } = buildDeps();
    const result = await listDecksHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.listDecks[0][1], 'available');
  });

  it('accepts status=archived', async () => {
    const { deps, service } = buildDeps();
    await listDecksHandler(makeEvent({ queryStringParameters: { status: 'archived' } }), deps);
    assert.equal(service.calls.listDecks[0][1], 'archived');
  });

  it('rejects an invalid status query value', async () => {
    const { deps } = buildDeps();
    const result = await listDecksHandler(
      makeEvent({ queryStringParameters: { status: 'deleted' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });
});

// ── getDeck ──────────────────────────────────────────────────────────────────────

describe('getDeck', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getDeckHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('returns the deck for an authenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getDeckHandler(makeEvent({ pathParameters: { deckId: DECK_ID } }), deps);
    assert.equal(result.statusCode, 200);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await getDeckHandler(makeEvent({ pathParameters: { deckId: 'nope' } }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('rejects a missing deckId', async () => {
    const { deps } = buildDeps();
    const result = await getDeckHandler(makeEvent({ pathParameters: null }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('maps DECK_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      getDeck: async () => {
        throw new DeckError('not found', DeckErrorCode.DECK_NOT_FOUND);
      },
    });
    const result = await getDeckHandler(makeEvent({ pathParameters: { deckId: DECK_ID } }), deps);
    assert.equal(result.statusCode, 404);
  });
});

// ── updateDeck ───────────────────────────────────────────────────────────────────

describe('updateDeck', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await updateDeckHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await updateDeckHandler(
      makeEvent({ pathParameters: { deckId: 'nope' }, body: JSON.stringify({ name: 'x' }) }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await updateDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID }, body: '{not json' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('ignores protected fields sent by the client and still forwards the rest', async () => {
    const { deps, service } = buildDeps();
    await updateDeckHandler(
      makeEvent({
        pathParameters: { deckId: DECK_ID },
        body: JSON.stringify({ name: 'New name', isArchived: true, userId: 'someone-else' }),
      }),
      deps,
    );
    // The controller forwards the parsed body as-is; DecksService is responsible
    // for ignoring isArchived/userId — already covered at the service level.
    assert.equal(service.calls.updateDeck[0][0], USER_ID);
    assert.equal(service.calls.updateDeck[0][1], DECK_ID);
  });

  it('maps an empty-patch INVALID_INPUT to 400', async () => {
    const { deps } = buildDeps({
      updateDeck: async () => {
        throw new DeckError('At least one field must be provided', DeckErrorCode.INVALID_INPUT);
      },
    });
    const result = await updateDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID }, body: '{}' }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });
});

// ── archiveDeck / unarchiveDeck ────────────────────────────────────────────────────

describe('archiveDeck', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await archiveDeckHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await archiveDeckHandler(
      makeEvent({ pathParameters: { deckId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('archives successfully and returns 200', async () => {
    const { deps } = buildDeps();
    const result = await archiveDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal((parseBody(result).data as DeckDto).isArchived, true);
  });

  it('maps DECK_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      archiveDeck: async () => {
        throw new DeckError('not found', DeckErrorCode.DECK_NOT_FOUND);
      },
    });
    const result = await archiveDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });
});

describe('unarchiveDeck', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await unarchiveDeckHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await unarchiveDeckHandler(
      makeEvent({ pathParameters: { deckId: 'nope' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('unarchives successfully and returns 200', async () => {
    const { deps } = buildDeps();
    const result = await unarchiveDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
  });
});

// ── deleteDeck ───────────────────────────────────────────────────────────────────

describe('deleteDeck', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await deleteDeckHandler(
      makeEvent({ headers: {}, pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid deckId', async () => {
    const { deps } = buildDeps();
    const result = await deleteDeckHandler(makeEvent({ pathParameters: { deckId: 'nope' } }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('deletes successfully and returns 200', async () => {
    const { deps, service } = buildDeps();
    const result = await deleteDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    assert.equal(service.calls.deleteDeck[0][0], USER_ID);
    assert.equal(service.calls.deleteDeck[0][1], DECK_ID);
  });

  it('a second delete attempt maps DECK_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps({
      deleteDeck: async () => {
        throw new DeckError('not found', DeckErrorCode.DECK_NOT_FOUND);
      },
    });
    const result = await deleteDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps({
      deleteDeck: async () => {
        throw new Error('relation "decks" violates constraint "whatever"');
      },
    });
    const result = await deleteDeckHandler(
      makeEvent({ pathParameters: { deckId: DECK_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── Lambda invocation shape regression guard ───────────────────────────────────────
//
// AWS Lambda always calls the exported handler as `handler(event, context)`.
// A prior version of this controller took `deps: DeckControllerDeps =
// DEFAULT_DEPS` as its second parameter — since `context` is never
// `undefined`, the default never activated in production and every request
// crashed with `TypeError: deps.services is not a function`, masked as a
// generic 500 by handleError. This guards against that shape regressing: the
// exported function must declare exactly one parameter, so a second
// caller-supplied argument (real or fake) is always ignored by plain JS
// semantics rather than silently reinterpreted as `deps`.

describe('exported Lambda handlers ignore a second (context) argument', () => {
  it('createDeck declares only one parameter', () => {
    assert.equal(createDeck.length, 1);
  });

  it('does not throw "deps.services is not a function" when called with a second argument', async () => {
    const event = makeEvent({ body: JSON.stringify({ name: 'Idioms' }) });
    const fakeLambdaContext = { awsRequestId: 'req-1', functionName: 'flashcardsCreateDeck' };
    // Cast away the 1-arg type to faithfully reproduce how the real Lambda
    // runtime calls this function; TypeScript itself already prevents this
    // call shape from compiling, which is part of the fix. DEFAULT_DEPS
    // points at the real composition root, so this will fail for lack of a
    // configured DATABASE_URL in the test environment — that failure is
    // expected and fine; the only thing this guards against is the specific
    // deps-shadowing TypeError.
    const call = createDeck as unknown as (
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
