process.env.JWT_SECRET = 'test-secret-for-practice-adaptive-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import { insightsHandler, recommendationsHandler } from './practiceAdaptiveController';
import { JwtService } from '../lib/jwt';
import {
  PracticeRecommendationError,
  PracticeRecommendationErrorCode,
} from '../services/practice/generate-practice-recommendation.service';
import type {
  PracticeInsights,
  PracticeRecommendation,
} from '../interfaces/practice/practice-adaptive.interface';

const USER_ID = 'user-1';
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

const INSIGHTS_STUB = {
  sample: {
    attemptCount: 3,
    itemCount: 15,
    correctCount: 10,
    incorrectCount: 5,
    unansweredCount: 0,
  },
} as unknown as PracticeInsights;

const RECOMMENDATION_STUB = {
  summary: 'Keep going.',
  strengths: ['skill-1'],
  focusAreas: ['skill-2'],
  recommendedPractice: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    reason: 'r',
  },
  studyTips: ['tip'],
} as unknown as PracticeRecommendation;

describe('getPracticeInsights (insightsHandler)', () => {
  it('rejects an unauthenticated request without calling the service', async () => {
    let called = false;
    const deps = {
      services: async () => ({
        getInsights: {
          execute: async () => {
            called = true;
            return INSIGHTS_STUB;
          },
        },
        generateRecommendation: {
          execute: async () => {
            throw new Error('unused');
          },
        },
      }),
    } as any;
    const result = await insightsHandler(makeEvent({ headers: {} }), deps);
    assert.equal(result.statusCode, 401);
    assert.equal(called, false);
  });

  it('returns insights for the authenticated user, never touching the AI generator', async () => {
    let userIdSeen: string | undefined;
    const deps = {
      services: async () => ({
        getInsights: {
          execute: async (userId: string) => {
            userIdSeen = userId;
            return INSIGHTS_STUB;
          },
        },
        generateRecommendation: {
          execute: async () => {
            throw new Error('must not be called');
          },
        },
      }),
    } as any;
    const result = await insightsHandler(makeEvent(), deps);
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, INSIGHTS_STUB);
    assert.equal(userIdSeen, USER_ID);
  });
});

describe('postPracticeRecommendations (recommendationsHandler)', () => {
  it('rejects an unauthenticated request', async () => {
    const deps = {
      services: async () => ({
        getInsights: { execute: async () => INSIGHTS_STUB },
        generateRecommendation: {
          execute: async () => ({
            status: 'ready',
            insights: INSIGHTS_STUB,
            recommendation: RECOMMENDATION_STUB,
          }),
        },
      }),
    } as any;
    const result = await recommendationsHandler(
      makeEvent({ headers: {}, body: JSON.stringify({ locale: 'en' }) }),
      deps,
    );
    assert.equal(result.statusCode, 401);
  });

  it('rejects an invalid locale as a 400', async () => {
    const deps = {
      services: async () => ({
        getInsights: { execute: async () => INSIGHTS_STUB },
        generateRecommendation: {
          execute: async () => {
            throw new Error('must not be called');
          },
        },
      }),
    } as any;
    const result = await recommendationsHandler(
      makeEvent({ body: JSON.stringify({ locale: 'fr' }) }),
      deps,
    );
    assert.equal(result.statusCode, 400);
  });

  it('defaults to locale "en" when no body is sent', async () => {
    let localeSeen: string | undefined;
    const deps = {
      services: async () => ({
        getInsights: { execute: async () => INSIGHTS_STUB },
        generateRecommendation: {
          execute: async (_userId: string, locale: string) => {
            localeSeen = locale;
            return {
              status: 'ready',
              insights: INSIGHTS_STUB,
              recommendation: RECOMMENDATION_STUB,
            };
          },
        },
      }),
    } as any;
    const result = await recommendationsHandler(makeEvent({ body: null }), deps);
    assert.equal(result.statusCode, 200);
    assert.equal(localeSeen, 'en');
  });

  it('returns a ready recommendation with the expected payload shape', async () => {
    const deps = {
      services: async () => ({
        getInsights: { execute: async () => INSIGHTS_STUB },
        generateRecommendation: {
          execute: async () => ({
            status: 'ready',
            insights: INSIGHTS_STUB,
            recommendation: RECOMMENDATION_STUB,
          }),
        },
      }),
    } as any;
    const result = await recommendationsHandler(
      makeEvent({ body: JSON.stringify({ locale: 'es' }) }),
      deps,
    );
    assert.equal(result.statusCode, 200);
    const body = parseBody(result);
    assert.equal(body.success, true);
    assert.deepEqual((body.data as any).recommendation, RECOMMENDATION_STUB);
  });

  const errorStatusCases: Array<{ code: PracticeRecommendationErrorCode; status: number }> = [
    { code: PracticeRecommendationErrorCode.INVALID_INPUT, status: 400 },
    { code: PracticeRecommendationErrorCode.RECOMMENDATION_IN_PROGRESS, status: 409 },
    { code: PracticeRecommendationErrorCode.AI_RATE_LIMITED, status: 429 },
    { code: PracticeRecommendationErrorCode.AI_INVALID_RESPONSE, status: 502 },
    { code: PracticeRecommendationErrorCode.AI_PROVIDER_UNAVAILABLE, status: 503 },
    { code: PracticeRecommendationErrorCode.AI_REQUEST_TIMEOUT, status: 504 },
    { code: PracticeRecommendationErrorCode.AI_CONFIGURATION_ERROR, status: 500 },
    { code: PracticeRecommendationErrorCode.PERSISTENCE_INCONSISTENCY, status: 500 },
  ];
  for (const { code, status } of errorStatusCases) {
    it(`maps ${code} to HTTP ${status}`, async () => {
      const deps = {
        services: async () => ({
          getInsights: { execute: async () => INSIGHTS_STUB },
          generateRecommendation: {
            execute: async () => {
              throw new PracticeRecommendationError(code);
            },
          },
        }),
      } as any;
      const result = await recommendationsHandler(
        makeEvent({ body: JSON.stringify({ locale: 'en' }) }),
        deps,
      );
      assert.equal(result.statusCode, status);
    });
  }

  it('maps an unrecognized thrown error to a generic 500 without leaking internals', async () => {
    const deps = {
      services: async () => ({
        getInsights: { execute: async () => INSIGHTS_STUB },
        generateRecommendation: {
          execute: async () => {
            throw new Error('raw provider stack trace or secret detail');
          },
        },
      }),
    } as any;
    const result = await recommendationsHandler(
      makeEvent({ body: JSON.stringify({ locale: 'en' }) }),
      deps,
    );
    assert.equal(result.statusCode, 500);
    const body = parseBody(result);
    assert.ok(!JSON.stringify(body).includes('raw provider stack trace'));
  });
});
