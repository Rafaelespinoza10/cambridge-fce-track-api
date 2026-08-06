process.env.JWT_SECRET = 'test-secret-for-practice-exercise-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  generatePracticeExercise,
  generatePracticeExerciseHandler,
  getPracticeExercise,
  getPracticeExerciseHandler,
} from './practiceExerciseController';
import type {
  PracticeExerciseControllerDeps,
  GenerateExerciseServicePort,
  GetExerciseServicePort,
} from './practiceExerciseController';
import { JwtService } from '../lib/jwt';
import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
} from '../services/practice/generate-practice-exercise.service';
import {
  PracticeExerciseError,
  PracticeExerciseErrorCode,
} from '../services/practice/practice-exercises.service';
import type { PracticeExerciseSafeWithItems } from '../interfaces/practice/practice-exercise.interface';

const USER_ID = 'user-1';
const TOKEN = JwtService.sign({ sub: USER_ID, email: 'user@example.com', role: 'student' });
const EXERCISE_ID = '22222222-2222-2222-2222-222222222222';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      taskType: 'multiple_choice_cloze',
    }),
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function parseBody(result: APIGatewayProxyResult): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

const SAFE_RESULT: PracticeExerciseSafeWithItems = {
  exercise: {
    id: EXERCISE_ID,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    targetLevel: 'B2' as never,
    title: 'Use of English - Part 1',
    instructions: 'Choose the correct word for each gap.',
    stimulus: 'A passage with gaps.',
    timeLimitSeconds: 900,
    itemCount: 8,
    createdAt: new Date(),
  },
  items: [],
};

// createdAt is a Date in the fake service's return value but a JSON string
// once it round-trips through the controller's JSON.stringify response body.
const SAFE_RESULT_JSON = JSON.parse(JSON.stringify(SAFE_RESULT)) as Record<string, unknown>;

interface FakeGenerateService extends GenerateExerciseServicePort {
  calls: Parameters<GenerateExerciseServicePort['execute']>[];
}

interface FakeGetService extends GetExerciseServicePort {
  calls: Parameters<GetExerciseServicePort['getExercise']>[];
}

function buildDeps(
  execute?: GenerateExerciseServicePort['execute'],
  getExercise?: GetExerciseServicePort['getExercise'],
): {
  deps: PracticeExerciseControllerDeps;
  generateService: FakeGenerateService;
  getService: FakeGetService;
} {
  const generateCalls: FakeGenerateService['calls'] = [];
  const generateService: FakeGenerateService = {
    calls: generateCalls,
    execute: async (...args) => {
      generateCalls.push(args);
      return execute ? execute(...args) : SAFE_RESULT;
    },
  };

  const getCalls: FakeGetService['calls'] = [];
  const getService: FakeGetService = {
    calls: getCalls,
    getExercise: async (...args) => {
      getCalls.push(args);
      return getExercise ? getExercise(...args) : SAFE_RESULT;
    },
  };

  return {
    deps: {
      services: async () => ({ generateExercise: generateService, getExercise: getService }),
    },
    generateService,
    getService,
  };
}

// ── generatePracticeExercise ────────────────────────────────────────────────

describe('generatePracticeExercise', () => {
  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeExerciseHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects malformed JSON', async () => {
    const { deps } = buildDeps();
    const result = await generatePracticeExerciseHandler(makeEvent({ body: '{not json' }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('generates an exercise and returns 201 with the safe DTO', async () => {
    const { deps, generateService } = buildDeps();
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 201);
    assert.deepEqual(parseBody(result).data, SAFE_RESULT_JSON);
    assert.equal(generateService.calls.length, 1);
  });

  it('forwards the authenticated userId as the first arg, never from the body', async () => {
    const { deps, generateService } = buildDeps();
    await generatePracticeExerciseHandler(
      makeEvent({
        body: JSON.stringify({
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_1',
          taskType: 'multiple_choice_cloze',
          userId: 'someone-else',
        }),
      }),
      deps,
    );
    assert.equal(generateService.calls[0]![0], USER_ID);
  });

  it('ignores unknown fields sent by the client', async () => {
    const { deps, generateService } = buildDeps();
    await generatePracticeExerciseHandler(
      makeEvent({
        body: JSON.stringify({
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_1',
          taskType: 'multiple_choice_cloze',
          itemCount: 999,
          extraField: 'should be ignored',
        }),
      }),
      deps,
    );
    assert.deepEqual(generateService.calls[0]![1], {
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      taskType: 'multiple_choice_cloze',
      targetLevel: undefined,
    });
  });

  it('maps INVALID_INPUT to 400', async () => {
    const { deps } = buildDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'taskType is not supported',
        GeneratePracticeExerciseErrorCode.INVALID_INPUT,
      );
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 400);
  });

  it('maps AI_RATE_LIMITED to 429', async () => {
    const { deps } = buildDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'rate limited',
        GeneratePracticeExerciseErrorCode.AI_RATE_LIMITED,
      );
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 429);
  });

  it('maps AI_PROVIDER_UNAVAILABLE to 503', async () => {
    const { deps } = buildDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'unavailable',
        GeneratePracticeExerciseErrorCode.AI_PROVIDER_UNAVAILABLE,
      );
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 503);
  });

  it('maps AI_REQUEST_TIMEOUT to 504', async () => {
    const { deps } = buildDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'timeout',
        GeneratePracticeExerciseErrorCode.AI_REQUEST_TIMEOUT,
      );
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 504);
  });

  it('maps AI_CONFIGURATION_ERROR to 500 without leaking the message', async () => {
    const { deps } = buildDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'OPEN_AI_API_KEY is not configured',
        GeneratePracticeExerciseErrorCode.AI_CONFIGURATION_ERROR,
      );
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });

  it('maps AI_INVALID_RESPONSE to 502', async () => {
    const { deps } = buildDeps(async () => {
      throw new GeneratePracticeExerciseError(
        'bad shape',
        GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE,
      );
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 502);
  });

  it('an unexpected error returns 500 without leaking internal details', async () => {
    const { deps } = buildDeps(async () => {
      throw new Error('ECONNREFUSED postgres://...');
    });
    const result = await generatePracticeExerciseHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 500);
    assert.equal(parseBody(result).message, 'Internal server error');
  });
});

// ── getPracticeExercise ─────────────────────────────────────────────────────

describe('getPracticeExercise', () => {
  function getEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
    return makeEvent({ pathParameters: { exerciseId: EXERCISE_ID }, ...overrides });
  }

  it('rejects an unauthenticated request', async () => {
    const { deps } = buildDeps();
    const result = await getPracticeExerciseHandler(getEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
  });

  it('rejects a missing exerciseId', async () => {
    const { deps } = buildDeps();
    const result = await getPracticeExerciseHandler(getEvent({ pathParameters: null }), deps);
    assert.equal(result.statusCode, 400);
  });

  it('rejects a non-UUID exerciseId', async () => {
    const { deps } = buildDeps();
    const result = await getPracticeExerciseHandler(
      getEvent({ pathParameters: { exerciseId: 'not-a-uuid' } }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('returns 200 with the safe DTO', async () => {
    const { deps, getService } = buildDeps();
    const result = await getPracticeExerciseHandler(getEvent(), deps);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(parseBody(result).data, SAFE_RESULT_JSON);
    assert.deepEqual(getService.calls[0], [USER_ID, EXERCISE_ID]);
  });

  it('maps EXERCISE_NOT_FOUND to 404', async () => {
    const { deps } = buildDeps(undefined, async () => {
      throw new PracticeExerciseError(
        'Practice exercise not found',
        PracticeExerciseErrorCode.EXERCISE_NOT_FOUND,
      );
    });
    const result = await getPracticeExerciseHandler(getEvent(), deps);
    assert.equal(result.statusCode, 404);
  });
});

// ── Lambda invocation shape regression guard ────────────────────────────────
//
// AWS Lambda always calls the exported handler as `handler(event, context)`.
// A second parameter with a default value never falls back to that default in
// production since `context` is never `undefined`.

describe('exported Lambda handlers ignore a second (context) argument', () => {
  it('generatePracticeExercise declares only one parameter', () => {
    assert.equal(generatePracticeExercise.length, 1);
  });

  it('getPracticeExercise declares only one parameter', () => {
    assert.equal(getPracticeExercise.length, 1);
  });

  it('does not throw "deps.services is not a function" when called with a second argument', async () => {
    const fakeLambdaContext = { awsRequestId: 'req-1', functionName: 'practiceGenerateExercise' };
    const call = generatePracticeExercise as unknown as (
      event: APIGatewayProxyEvent,
      context: unknown,
    ) => Promise<APIGatewayProxyResult>;
    try {
      await call(makeEvent(), fakeLambdaContext);
    } catch (err) {
      assert.ok(
        !(err instanceof TypeError && err.message.includes('deps.services is not a function')),
        `regressed: ${String(err)}`,
      );
    }
  });
});
