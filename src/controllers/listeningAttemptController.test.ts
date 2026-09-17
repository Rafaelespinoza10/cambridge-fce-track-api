process.env.JWT_SECRET = 'test-secret-for-listening-attempt-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  listListeningSources,
  listListeningSourcesHandler,
  getListeningSource,
  getListeningSourceHandler,
  startListeningAttempt,
  startListeningAttemptHandler,
  submitListeningAttempt,
  submitListeningAttemptHandler,
  getListeningAttempt,
  getListeningAttemptHandler,
} from './listeningAttemptController';
import type {
  ListeningAttemptControllerDeps,
  ListSourcesPort,
  GetSourcePort,
  StartAttemptPort,
  SubmitAttemptPort,
  GetAttemptPort,
} from './listeningAttemptController';
import { JwtService } from '@lib/shared/jwt';
import { ListeningAttemptStatus } from '../models/enums';
import {
  GetListeningSourceError,
  GetListeningSourceErrorCode,
} from '../services/listening/get-listening-source.service';
import {
  StartListeningAttemptError,
  StartListeningAttemptErrorCode,
} from '../services/listening/start-listening-attempt.service';
import {
  SubmitListeningAttemptError,
  SubmitListeningAttemptErrorCode,
} from '../services/listening/submit-listening-attempt.service';
import {
  GetListeningAttemptError,
  GetListeningAttemptErrorCode,
} from '../services/listening/get-listening-attempt.service';
import type {
  ListeningAttemptStartResultDto,
  ListeningAttemptViewDto,
  ListeningAttemptSubmitResultDto,
} from '../interfaces/listening/listening-attempt.interface';

const USER_ID = 'user-1';
const SOURCE_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = '22222222-2222-2222-2222-222222222222';
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

const SAFE_SOURCE = {
  id: SOURCE_ID,
  examCode: 'B2_FIRST',
  paperCode: 'PAPER_4',
  partCode: 'LISTENING_PART_1',
  title: 't',
  instructions: 'i',
  targetLevel: null,
  videoProvider: 'youtube',
  videoExternalId: 'abc',
  videoStartSeconds: 0,
  videoEndSeconds: 60,
  status: 'active' as never,
  itemCount: 1,
  createdAt: FIXED_NOW,
};

const SAFE_ATTEMPT = {
  id: ATTEMPT_ID,
  sourceId: SOURCE_ID,
  status: ListeningAttemptStatus.IN_PROGRESS,
  startedAt: FIXED_NOW,
  totalCount: 1,
};

const START_RESULT: ListeningAttemptStartResultDto = {
  view: { attempt: SAFE_ATTEMPT, source: SAFE_SOURCE, items: [], result: null },
};

const VIEW: ListeningAttemptViewDto = {
  attempt: SAFE_ATTEMPT,
  source: SAFE_SOURCE,
  items: [],
  result: null,
};

const RESULT_DTO = {
  attemptId: ATTEMPT_ID,
  sourceId: SOURCE_ID,
  submittedAt: FIXED_NOW,
  durationSeconds: 120,
  correctCount: 1,
  totalCount: 1,
  percentage: 100,
  feedbackSummary: {
    version: 'listening-attempt-feedback-v1' as const,
    unansweredCount: 0,
    skillBreakdown: [],
  },
  items: [],
};

const SUBMIT_RESULT: ListeningAttemptSubmitResultDto = {
  result: RESULT_DTO,
  idempotentReplay: false,
};

function buildDeps(
  overrides: {
    listSourcesExecute?: ListSourcesPort['execute'];
    getSourceExecute?: GetSourcePort['execute'];
    startExecute?: StartAttemptPort['execute'];
    submitExecute?: SubmitAttemptPort['execute'];
    getExecute?: GetAttemptPort['execute'];
  } = {},
): ListeningAttemptControllerDeps {
  return {
    now: () => FIXED_NOW,
    services: async () => ({
      listSources: { execute: overrides.listSourcesExecute ?? (async () => [SAFE_SOURCE]) },
      getSource: { execute: overrides.getSourceExecute ?? (async () => SAFE_SOURCE) },
      startAttempt: { execute: overrides.startExecute ?? (async () => START_RESULT) },
      submitAttempt: { execute: overrides.submitExecute ?? (async () => SUBMIT_RESULT) },
      getAttempt: { execute: overrides.getExecute ?? (async () => VIEW) },
    }),
  };
}

describe('listListeningSources', () => {
  it('401s with no token', async () => {
    const result = await listListeningSourcesHandler(
      makeEvent({ headers: {} }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 401);
  });

  it('200s with the active catalog', async () => {
    const result = await listListeningSourcesHandler(makeEvent(), buildDeps());
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal((body.data as { sources: unknown[] }).sources.length, 1);
  });

  it('is exported as the real Lambda entry point', () => {
    assert.equal(typeof listListeningSources, 'function');
  });
});

describe('getListeningSource', () => {
  it('400s on an invalid sourceId', async () => {
    const result = await getListeningSourceHandler(
      makeEvent({ pathParameters: { sourceId: 'not-a-uuid' } }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 400);
  });

  it('200s with the source', async () => {
    const result = await getListeningSourceHandler(
      makeEvent({ pathParameters: { sourceId: SOURCE_ID } }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 200);
  });

  it('maps a not-found source to 404', async () => {
    const deps = buildDeps({
      getSourceExecute: async () => {
        throw new GetListeningSourceError('nope', GetListeningSourceErrorCode.SOURCE_NOT_FOUND);
      },
    });
    const result = await getListeningSourceHandler(
      makeEvent({ pathParameters: { sourceId: SOURCE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('is exported as the real Lambda entry point', () => {
    assert.equal(typeof getListeningSource, 'function');
  });
});

describe('startListeningAttempt', () => {
  it('400s on an invalid sourceId', async () => {
    const result = await startListeningAttemptHandler(
      makeEvent({ pathParameters: { sourceId: 'bad' } }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 400);
  });

  it('201s with the started view', async () => {
    const result = await startListeningAttemptHandler(
      makeEvent({ pathParameters: { sourceId: SOURCE_ID } }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 201);
    const body = parseBody(result);
    assert.equal((body.data as { attempt: { id: string } }).attempt.id, ATTEMPT_ID);
  });

  it('maps a not-found source to 404', async () => {
    const deps = buildDeps({
      startExecute: async () => {
        throw new StartListeningAttemptError(
          'nope',
          StartListeningAttemptErrorCode.SOURCE_NOT_FOUND,
        );
      },
    });
    const result = await startListeningAttemptHandler(
      makeEvent({ pathParameters: { sourceId: SOURCE_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('is exported as the real Lambda entry point', () => {
    assert.equal(typeof startListeningAttempt, 'function');
  });
});

describe('submitListeningAttempt', () => {
  it('400s on an invalid attemptId', async () => {
    const result = await submitListeningAttemptHandler(
      makeEvent({ pathParameters: { attemptId: 'bad' }, body: '{}' }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 400);
  });

  it('400s on an invalid JSON body', async () => {
    const result = await submitListeningAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID }, body: '{not json' }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 400);
  });

  it('200s with the graded result', async () => {
    const result = await submitListeningAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal((body.data as { correctCount: number }).correctCount, 1);
  });

  it('maps a not-found attempt to 404', async () => {
    const deps = buildDeps({
      submitExecute: async () => {
        throw new SubmitListeningAttemptError(
          'nope',
          SubmitListeningAttemptErrorCode.ATTEMPT_NOT_FOUND,
        );
      },
    });
    const result = await submitListeningAttemptHandler(
      makeEvent({
        pathParameters: { attemptId: ATTEMPT_ID },
        body: JSON.stringify({ answers: [] }),
      }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('is exported as the real Lambda entry point', () => {
    assert.equal(typeof submitListeningAttempt, 'function');
  });
});

describe('getListeningAttempt', () => {
  it('400s on an invalid attemptId', async () => {
    const result = await getListeningAttemptHandler(
      makeEvent({ pathParameters: { attemptId: 'bad' } }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 400);
  });

  it('200s with the attempt view', async () => {
    const result = await getListeningAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      buildDeps(),
    );
    assert.equal(result.statusCode, 200);
  });

  it('maps a not-found attempt to 404', async () => {
    const deps = buildDeps({
      getExecute: async () => {
        throw new GetListeningAttemptError(
          'nope',
          GetListeningAttemptErrorCode.ATTEMPT_NOT_FOUND,
        );
      },
    });
    const result = await getListeningAttemptHandler(
      makeEvent({ pathParameters: { attemptId: ATTEMPT_ID } }),
      deps,
    );
    assert.equal(result.statusCode, 404);
  });

  it('is exported as the real Lambda entry point', () => {
    assert.equal(typeof getListeningAttempt, 'function');
  });
});
