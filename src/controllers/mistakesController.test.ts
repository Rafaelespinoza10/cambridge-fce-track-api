process.env.JWT_SECRET = 'test-secret-for-mistakes-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { listMistakesHandler } from './mistakesController';
import type { MistakesControllerDeps } from './mistakesController';
import { JwtService } from '@lib/shared/jwt';
import {
  ListMistakesError,
  ListMistakesErrorCode,
} from '../services/mistakes/list-mistakes.service';
import type { ListMistakesRawQuery } from '../services/mistakes/list-mistakes.service';
import type { ListMistakesResponseDto } from '../interfaces/mistakes/mistakes.interface';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const TOKEN = JwtService.sign({ sub: USER_ID, email: 'user@example.com', role: 'student' });

const EMPTY_RESULT: ListMistakesResponseDto = {
  items: [],
  pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
};

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

interface Spy {
  deps: MistakesControllerDeps;
  calls: Array<{ userId: string; rawQuery: ListMistakesRawQuery }>;
}

function makeDeps(execute?: () => Promise<ListMistakesResponseDto>): Spy {
  const calls: Spy['calls'] = [];
  const deps: MistakesControllerDeps = {
    services: async () => ({
      listMistakes: {
        execute: async (userId, rawQuery) => {
          calls.push({ userId, rawQuery });
          return execute === undefined ? EMPTY_RESULT : execute();
        },
      },
    }),
  };
  return { deps, calls };
}

describe('listMistakes (listMistakesHandler)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const { deps, calls } = makeDeps();

    const result = await listMistakesHandler(makeEvent({ headers: {} }), deps);

    assert.equal(result.statusCode, 401);
    assert.equal(calls.length, 0);
  });

  it('rejects a request whose token is not signed with the API secret', async () => {
    const { deps, calls } = makeDeps();
    const forged = `Bearer ${TOKEN}tampered`;

    const result = await listMistakesHandler(
      makeEvent({ headers: { Authorization: forged } }),
      deps,
    );

    assert.equal(result.statusCode, 401);
    assert.equal(calls.length, 0);
  });

  it('reads the owner from the verified token, never from the query string', async () => {
    const { deps, calls } = makeDeps();

    const result = await listMistakesHandler(
      makeEvent({ queryStringParameters: { userId: OTHER_USER_ID } }),
      deps,
    );

    assert.equal(result.statusCode, 200);
    assert.equal(calls[0].userId, USER_ID);
    assert.equal(
      Object.prototype.hasOwnProperty.call(calls[0].rawQuery, 'userId'),
      false,
      'a client-sent userId must never reach the service',
    );
  });

  it('forwards only the supported filters', async () => {
    const { deps, calls } = makeDeps();

    await listMistakesHandler(
      makeEvent({
        queryStringParameters: {
          skill: 'use-of-english',
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_3',
          errorType: 'word_class',
          baseWord: 'RESPONSIBLE',
          page: '2',
          pageSize: '10',
          somethingElse: 'ignored',
        },
      }),
      deps,
    );

    assert.deepEqual(calls[0].rawQuery, {
      skill: 'use-of-english',
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_3',
      errorType: 'word_class',
      baseWord: 'RESPONSIBLE',
      page: '2',
      pageSize: '10',
    });
  });

  it('returns the service result under the standard success envelope', async () => {
    const { deps } = makeDeps(async () => EMPTY_RESULT);

    const result = await listMistakesHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, JSON.parse(JSON.stringify(EMPTY_RESULT)));
  });

  it('maps an invalid filter to 400 with its message', async () => {
    const { deps } = makeDeps(async () => {
      throw new ListMistakesError('Unknown skill "maths"', ListMistakesErrorCode.UNSUPPORTED_SKILL);
    });

    const result = await listMistakesHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 400);
    assert.equal(parseBody(result).message, 'Unknown skill "maths"');
  });

  it('masks an unexpected failure as a 500 without leaking its message', async () => {
    const { deps } = makeDeps(async () => {
      throw new Error('relation "mistake_concepts" does not exist');
    });

    const result = await listMistakesHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});
