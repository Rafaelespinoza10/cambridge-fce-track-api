process.env.JWT_SECRET = 'test-secret-for-flashcard-ai-draft-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  generateFlashcardDraft,
  generateFlashcardDraftHandler,
} from './flashcardAiDraftController';
import type {
  FlashcardAiDraftControllerDeps,
  GenerateFlashcardDraftServicePort,
} from './flashcardAiDraftController';
import { JwtService } from '@lib/shared/jwt';
import {
  GenerateFlashcardDraftError,
  GenerateFlashcardDraftErrorCode,
} from '../services/flashcards/generate-flashcard-draft.service';
import { FlashcardType } from '../models/enums';
import type { GeneratedFlashcardDraftDto } from '../interfaces/flashcards/generate-flashcard-draft.interface';

const USER_ID = 'user-1';
const TOKEN = JwtService.sign({ sub: USER_ID, email: 'user@example.com', role: 'student' });

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function parseBody(result: APIGatewayProxyResult): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

const DRAFT_DTO: GeneratedFlashcardDraftDto = {
  type: FlashcardType.PHRASAL_VERB,
  front: 'iron out',
  back: 'to resolve or remove difficulties, problems, or disagreements',
  translation: 'resolver, solucionar o limar diferencias',
  example: 'We need to iron out a few issues before releasing the application.',
  personalExample: 'I need to iron out the remaining bugs in my Cambridge tracker.',
  notes: 'Commonly used with problems, details, differences, and difficulties.',
  sourceName: null,
  sourceUrl: null,
  level: null,
  tags: ['phrasal-verbs', 'problem-solving', 'work'],
};

interface FakeService extends GenerateFlashcardDraftServicePort {
  calls: Parameters<GenerateFlashcardDraftServicePort['execute']>[];
}

function buildDeps(execute?: GenerateFlashcardDraftServicePort['execute']): {
  deps: FlashcardAiDraftControllerDeps;
  service: FakeService;
} {
  const calls: FakeService['calls'] = [];
  const service: FakeService = {
    calls,
    execute: async (...args) => {
      calls.push(args);
      return execute ? execute(...args) : DRAFT_DTO;
    },
  };
  return { deps: { services: async () => ({ generateDraft: service }) }, service };
}

// ── generateFlashcardDraft ──────────────────────────────────────────────────────

describe('generateFlashcardDraft', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await generateFlashcardDraftHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await generateFlashcardDraftHandler(makeEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('generates a draft and returns 200 with the DTO', async () => {
    const { deps, service } = buildDeps();
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, DRAFT_DTO);
    assert.equal(service.calls.length, 1);
  });

  it('forwards only term and type to the service, never userId', async () => {
    const { deps, service } = buildDeps();
    await generateFlashcardDraftHandler(
      makeEvent({
        body: JSON.stringify({
          term: 'iron out',
          type: FlashcardType.PHRASAL_VERB,
          userId: 'someone-else',
        }),
      }),
      deps,
    );
    assert.deepEqual(service.calls[0]![0], { term: 'iron out', type: FlashcardType.PHRASAL_VERB });
  });

  it('ignores unknown fields sent by the client', async () => {
    const { deps, service } = buildDeps();
    await generateFlashcardDraftHandler(
      makeEvent({
        body: JSON.stringify({
          term: 'iron out',
          type: FlashcardType.PHRASAL_VERB,
          extraField: 'should be ignored',
        }),
      }),
      deps,
    );
    assert.deepEqual(service.calls[0]![0], { term: 'iron out', type: FlashcardType.PHRASAL_VERB });
  });

  it('ignores scheduling data sent by the client', async () => {
    const { deps, service } = buildDeps();
    await generateFlashcardDraftHandler(
      makeEvent({
        body: JSON.stringify({
          term: 'iron out',
          type: FlashcardType.PHRASAL_VERB,
          status: 'review',
          nextReviewAt: '2026-01-01T00:00:00.000Z',
          intervalMinutes: 999,
          easeFactor: 2.9,
          repetitions: 10,
          lapses: 0,
        }),
      }),
      deps,
    );
    assert.deepEqual(service.calls[0]![0], { term: 'iron out', type: FlashcardType.PHRASAL_VERB });
  });

  it('maps INVALID_INPUT to 400', async () => {
    const { deps } = buildDeps(async () => {
      throw new GenerateFlashcardDraftError(
        'term must not be empty',
        GenerateFlashcardDraftErrorCode.INVALID_INPUT,
      );
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 400);
  });

  it('maps AI_RATE_LIMITED to 429', async () => {
    const { deps } = buildDeps(async () => {
      throw new GenerateFlashcardDraftError(
        'rate limited',
        GenerateFlashcardDraftErrorCode.AI_RATE_LIMITED,
      );
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 429);
  });

  it('maps AI_PROVIDER_UNAVAILABLE to 503', async () => {
    const { deps } = buildDeps(async () => {
      throw new GenerateFlashcardDraftError(
        'unavailable',
        GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
      );
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 503);
  });

  it('maps AI_REQUEST_TIMEOUT to 504', async () => {
    const { deps } = buildDeps(async () => {
      throw new GenerateFlashcardDraftError(
        'timeout',
        GenerateFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
      );
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 504);
  });

  it('maps AI_CONFIGURATION_ERROR to 500 without leaking the message', async () => {
    const { deps } = buildDeps(async () => {
      throw new GenerateFlashcardDraftError(
        'OPEN_AI_API_KEY is not configured',
        GenerateFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
      );
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });

  it('maps AI_INVALID_RESPONSE to 502', async () => {
    const { deps } = buildDeps(async () => {
      throw new GenerateFlashcardDraftError(
        'bad shape',
        GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
      );
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 502);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps(async () => {
      throw new Error('ENOTFOUND api.openai.com');
    });
    const result = await generateFlashcardDraftHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── Lambda invocation shape regression guard ───────────────────────────────────────
//
// AWS Lambda always calls the exported handler as `handler(event, context)`.
// A second parameter with a default value never falls back to that default in
// production since `context` is never `undefined`. This guards against that
// shape regressing (see flashcardProgressController for the original incident).

describe('exported Lambda handler ignores a second (context) argument', () => {
  it('generateFlashcardDraft declares only one parameter', () => {
    assert.equal(generateFlashcardDraft.length, 1);
  });

  it('does not throw "deps.services is not a function" when called with a second argument', async () => {
    const event = makeEvent();
    const fakeLambdaContext = { awsRequestId: 'req-1', functionName: 'flashcardsGenerateAiDraft' };
    const call = generateFlashcardDraft as unknown as (
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
