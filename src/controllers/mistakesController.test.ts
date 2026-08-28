process.env.JWT_SECRET = 'test-secret-for-mistakes-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  listMistakesHandler,
  listWeaknessesHandler,
  listDueReviewsHandler,
  generateMistakePracticeHandler,
  generateMistakeRemixHandler,
} from './mistakesController';
import type { MistakesControllerDeps } from './mistakesController';
import type { GenerateMistakeRemixRequest } from '../interfaces/practice/practice-mistake-remix.interface';
import { JwtService } from '@lib/shared/jwt';
import {
  ListMistakesError,
  ListMistakesErrorCode,
} from '../services/mistakes/list-mistakes.service';
import {
  ListWeaknessesError,
  ListWeaknessesErrorCode,
} from '../services/mistakes/list-weaknesses.service';
import type { ListWeaknessesRawQuery } from '../services/mistakes/list-weaknesses.service';
import type { ListWeaknessesResponseDto } from '../interfaces/mistakes/weaknesses.interface';
import {
  ListReviewsError,
  ListReviewsErrorCode,
} from '../services/mistakes/list-due-reviews.service';
import type { ListReviewsRawQuery } from '../services/mistakes/list-due-reviews.service';
import type { ListReviewsResponseDto } from '../interfaces/mistakes/reviews.interface';
import type { ListMistakesRawQuery } from '../services/mistakes/list-mistakes.service';
import type { ListMistakesResponseDto } from '../interfaces/mistakes/mistakes.interface';
import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
} from '@lib/practice/generate-practice-exercise-core';
import type { GenerateMistakePracticeRequest } from '../interfaces/practice/practice-mistake-generation.interface';
import type { PracticeExerciseSafeWithItems } from '../interfaces/practice/practice-exercise.interface';

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
      listWeaknesses: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
      listDueReviews: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    generationServices: async () => ({
      generateMistakePractice: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    remixGenerationServices: async () => ({
      generateMistakeRemix: {
        execute: async () => {
          throw new Error('not used by these tests');
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

// ── POST /practice/mistakes/generate ─────────────────────────────────────────

const SAFE_EXERCISE: PracticeExerciseSafeWithItems = {
  exercise: {
    id: 'exercise-id',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    targetLevel: 'B2' as never,
    title: 't',
    instructions: 'i',
    stimulus: null,
    timeLimitSeconds: null,
    itemCount: 8,
    createdAt: new Date(),
  },
  items: [],
};

interface GenerateSpy {
  deps: MistakesControllerDeps;
  calls: Array<{ userId: string; idempotencyKey: string; request: GenerateMistakePracticeRequest }>;
}

function makeGenerateDeps(execute?: () => Promise<PracticeExerciseSafeWithItems>): GenerateSpy {
  const calls: GenerateSpy['calls'] = [];
  const deps: MistakesControllerDeps = {
    services: async () => ({
      listMistakes: { execute: async () => EMPTY_RESULT },
      listWeaknesses: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
      listDueReviews: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    generationServices: async () => ({
      generateMistakePractice: {
        execute: async (userId, idempotencyKey, request) => {
          calls.push({ userId, idempotencyKey, request });
          return execute === undefined ? SAFE_EXERCISE : execute();
        },
      },
    }),
    remixGenerationServices: async () => ({
      generateMistakeRemix: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
  };
  return { deps, calls };
}

describe('generateMistakePractice (generateMistakePracticeHandler)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const { deps, calls } = makeGenerateDeps();

    const result = await generateMistakePracticeHandler(
      makeEvent({ headers: {}, body: JSON.stringify({ mistakeConceptIds: ['a'] }) }),
      deps,
    );

    assert.equal(result.statusCode, 401);
    assert.equal(calls.length, 0);
  });

  it('rejects an unparseable body with 400', async () => {
    const { deps } = makeGenerateDeps();

    const result = await generateMistakePracticeHandler(makeEvent({ body: '{not json' }), deps);

    assert.equal(result.statusCode, 400);
  });

  it('reads the owner from the verified token and forwards mistakeConceptIds/questionCount/idempotencyKey', async () => {
    const { deps, calls } = makeGenerateDeps();

    await generateMistakePracticeHandler(
      makeEvent({
        body: JSON.stringify({
          mistakeConceptIds: ['concept-1', 'concept-2'],
          questionCount: 10,
          idempotencyKey: 'idem-1',
        }),
      }),
      deps,
    );

    assert.equal(calls[0].userId, USER_ID);
    assert.equal(calls[0].idempotencyKey, 'idem-1');
    assert.deepEqual(calls[0].request.mistakeConceptIds, ['concept-1', 'concept-2']);
    assert.equal(calls[0].request.questionCount, 10);
    assert.equal(calls[0].request.mode, undefined);
  });

  it('forwards mode: "weaknesses" and ignores an unknown mode value', async () => {
    const { deps, calls } = makeGenerateDeps();

    await generateMistakePracticeHandler(
      makeEvent({ body: JSON.stringify({ mode: 'weaknesses', idempotencyKey: 'idem-1' }) }),
      deps,
    );
    assert.equal(calls[0].request.mode, 'weaknesses');

    await generateMistakePracticeHandler(
      makeEvent({ body: JSON.stringify({ mode: 'bogus', idempotencyKey: 'idem-2' }) }),
      deps,
    );
    assert.equal(calls[1].request.mode, undefined);
  });

  it('returns the generated exercise under the standard success envelope with a 201', async () => {
    const { deps } = makeGenerateDeps(async () => SAFE_EXERCISE);

    const result = await generateMistakePracticeHandler(
      makeEvent({ body: JSON.stringify({ mistakeConceptIds: ['a'], idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 201);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, JSON.parse(JSON.stringify(SAFE_EXERCISE)));
  });

  it('maps NO_ELIGIBLE_MISTAKES to 404', async () => {
    const { deps } = makeGenerateDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'No eligible mistakes',
        GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES,
      );
    });

    const result = await generateMistakePracticeHandler(
      makeEvent({ body: JSON.stringify({ mistakeConceptIds: ['a'], idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 404);
  });

  it('masks an unexpected failure as a 500 without leaking its message', async () => {
    const { deps } = makeGenerateDeps(async () => {
      throw new Error('relation "mistake_concepts" does not exist');
    });

    const result = await generateMistakePracticeHandler(
      makeEvent({ body: JSON.stringify({ mistakeConceptIds: ['a'], idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── GET /practice/weaknesses ─────────────────────────────────────────────────

const EMPTY_WEAKNESSES: ListWeaknessesResponseDto = { items: [], totalItems: 0 };

interface WeaknessSpy {
  deps: MistakesControllerDeps;
  calls: Array<{ userId: string; rawQuery: ListWeaknessesRawQuery }>;
}

function makeWeaknessDeps(execute?: () => Promise<ListWeaknessesResponseDto>): WeaknessSpy {
  const calls: WeaknessSpy['calls'] = [];
  const deps: MistakesControllerDeps = {
    services: async () => ({
      listMistakes: { execute: async () => EMPTY_RESULT },
      listWeaknesses: {
        execute: async (userId, rawQuery) => {
          calls.push({ userId, rawQuery });
          return execute === undefined ? EMPTY_WEAKNESSES : execute();
        },
      },
      listDueReviews: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    generationServices: async () => ({
      generateMistakePractice: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    remixGenerationServices: async () => ({
      generateMistakeRemix: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
  };
  return { deps, calls };
}

describe('listWeaknesses (listWeaknessesHandler)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const { deps, calls } = makeWeaknessDeps();

    const result = await listWeaknessesHandler(makeEvent({ headers: {} }), deps);

    assert.equal(result.statusCode, 401);
    assert.equal(calls.length, 0);
  });

  it('reads the owner from the verified token, never from the query string', async () => {
    const { deps, calls } = makeWeaknessDeps();

    const result = await listWeaknessesHandler(
      makeEvent({ queryStringParameters: { userId: 'someone-else' } }),
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
    const { deps, calls } = makeWeaknessDeps();

    await listWeaknessesHandler(
      makeEvent({
        queryStringParameters: {
          skill: 'use-of-english',
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_3',
          errorType: 'word_class',
          errorSubtype: 'adjective_to_adverb',
          status: 'learning',
          page: '3',
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
      errorSubtype: 'adjective_to_adverb',
      status: 'learning',
    });
  });

  it('returns the service result under the standard success envelope', async () => {
    const { deps } = makeWeaknessDeps();

    const result = await listWeaknessesHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, { items: [], totalItems: 0 });
  });

  it('maps an invalid filter to 400 with its message', async () => {
    const { deps } = makeWeaknessDeps(async () => {
      throw new ListWeaknessesError(
        'Unknown skill "maths"',
        ListWeaknessesErrorCode.UNSUPPORTED_SKILL,
      );
    });

    const result = await listWeaknessesHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 400);
    assert.equal(parseBody(result).message, 'Unknown skill "maths"');
  });

  it('masks an unexpected failure as a 500 without leaking its message', async () => {
    const { deps } = makeWeaknessDeps(async () => {
      throw new Error('relation "mistake_occurrences" does not exist');
    });

    const result = await listWeaknessesHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── POST /practice/mistakes/remix ────────────────────────────────────────────

interface RemixSpy {
  deps: MistakesControllerDeps;
  calls: Array<{ userId: string; idempotencyKey: string; request: GenerateMistakeRemixRequest }>;
}

function makeRemixDeps(execute?: () => Promise<PracticeExerciseSafeWithItems>): RemixSpy {
  const calls: RemixSpy['calls'] = [];
  const deps: MistakesControllerDeps = {
    services: async () => ({
      listMistakes: { execute: async () => EMPTY_RESULT },
      listWeaknesses: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
      listDueReviews: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    generationServices: async () => ({
      generateMistakePractice: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    remixGenerationServices: async () => ({
      generateMistakeRemix: {
        execute: async (userId, idempotencyKey, request) => {
          calls.push({ userId, idempotencyKey, request });
          return execute === undefined ? SAFE_EXERCISE : execute();
        },
      },
    }),
  };
  return { deps, calls };
}

describe('generateMistakeRemix (generateMistakeRemixHandler)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const { deps, calls } = makeRemixDeps();

    const result = await generateMistakeRemixHandler(
      makeEvent({ headers: {}, body: JSON.stringify({ idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 401);
    assert.equal(calls.length, 0);
  });

  it('rejects an unparseable body with 400', async () => {
    const { deps } = makeRemixDeps();

    const result = await generateMistakeRemixHandler(makeEvent({ body: '{not json' }), deps);

    assert.equal(result.statusCode, 400);
  });

  it('reads the owner from the verified token and forwards only questionCount/idempotencyKey — never a client-sent userId or mistakeConceptIds', async () => {
    const { deps, calls } = makeRemixDeps();

    await generateMistakeRemixHandler(
      makeEvent({
        body: JSON.stringify({
          questionCount: 15,
          idempotencyKey: 'idem-1',
          userId: 'someone-else',
          mistakeConceptIds: ['not-honoured'],
        }),
      }),
      deps,
    );

    assert.equal(calls[0].userId, USER_ID);
    assert.equal(calls[0].idempotencyKey, 'idem-1');
    assert.equal(calls[0].request.questionCount, 15);
    assert.equal(
      Object.prototype.hasOwnProperty.call(calls[0].request, 'mistakeConceptIds'),
      false,
      'mistakeConceptIds must never reach the remix service — selection is server-side only',
    );
  });

  it('returns the generated exercise under the standard success envelope with a 201', async () => {
    const { deps } = makeRemixDeps(async () => SAFE_EXERCISE);

    const result = await generateMistakeRemixHandler(
      makeEvent({ body: JSON.stringify({ idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 201);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, JSON.parse(JSON.stringify(SAFE_EXERCISE)));
  });

  it('maps NO_ELIGIBLE_MISTAKES to 404', async () => {
    const { deps } = makeRemixDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'No eligible weaknesses',
        GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES,
      );
    });

    const result = await generateMistakeRemixHandler(
      makeEvent({ body: JSON.stringify({ idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 404);
  });

  it('masks an unexpected failure as a 500 without leaking its message', async () => {
    const { deps } = makeRemixDeps(async () => {
      throw new Error('relation "mistake_concepts" does not exist');
    });

    const result = await generateMistakeRemixHandler(
      makeEvent({ body: JSON.stringify({ idempotencyKey: 'idem-1' }) }),
      deps,
    );

    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── GET /practice/reviews ────────────────────────────────────────────────────

const EMPTY_REVIEWS: ListReviewsResponseDto = { items: [], dueCount: 0, totalItems: 0 };

interface ReviewSpy {
  deps: MistakesControllerDeps;
  calls: Array<{ userId: string; rawQuery: ListReviewsRawQuery }>;
}

function makeReviewDeps(execute?: () => Promise<ListReviewsResponseDto>): ReviewSpy {
  const calls: ReviewSpy['calls'] = [];
  const deps: MistakesControllerDeps = {
    services: async () => ({
      listMistakes: { execute: async () => EMPTY_RESULT },
      listWeaknesses: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
      listDueReviews: {
        execute: async (userId, rawQuery) => {
          calls.push({ userId, rawQuery });
          return execute === undefined ? EMPTY_REVIEWS : execute();
        },
      },
    }),
    generationServices: async () => ({
      generateMistakePractice: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
    remixGenerationServices: async () => ({
      generateMistakeRemix: {
        execute: async () => {
          throw new Error('not used by these tests');
        },
      },
    }),
  };
  return { deps, calls };
}

describe('listDueReviews (listDueReviewsHandler)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    const { deps, calls } = makeReviewDeps();

    const result = await listDueReviewsHandler(makeEvent({ headers: {} }), deps);

    assert.equal(result.statusCode, 401);
    assert.equal(calls.length, 0);
  });

  it('reads the owner from the verified token, never from the query string', async () => {
    const { deps, calls } = makeReviewDeps();

    const result = await listDueReviewsHandler(
      makeEvent({ queryStringParameters: { userId: 'someone-else' } }),
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

  it('forwards only the status filter', async () => {
    const { deps, calls } = makeReviewDeps();

    await listDueReviewsHandler(
      makeEvent({ queryStringParameters: { status: 'due', limit: '500' } }),
      deps,
    );

    assert.deepEqual(calls[0].rawQuery, { status: 'due' });
  });

  it('returns the service result under the standard success envelope', async () => {
    const { deps } = makeReviewDeps();

    const result = await listDueReviewsHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, { items: [], dueCount: 0, totalItems: 0 });
  });

  it('maps an invalid filter to 400 with its message', async () => {
    const { deps } = makeReviewDeps(async () => {
      throw new ListReviewsError(
        'status must be one of: due, upcoming, all',
        ListReviewsErrorCode.INVALID_INPUT,
      );
    });

    const result = await listDueReviewsHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 400);
    assert.equal(parseBody(result).message, 'status must be one of: due, upcoming, all');
  });

  it('masks an unexpected failure as a 500 without leaking its message', async () => {
    const { deps } = makeReviewDeps(async () => {
      throw new Error('relation "weakness_reviews" does not exist');
    });

    const result = await listDueReviewsHandler(makeEvent(), deps);

    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});
