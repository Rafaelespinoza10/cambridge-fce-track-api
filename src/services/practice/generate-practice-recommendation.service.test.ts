import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GeneratePracticeRecommendationService,
  PracticeRecommendationError,
  PracticeRecommendationErrorCode,
  practiceInsightsSnapshotHash,
} from './generate-practice-recommendation.service';
import { GetPracticeInsightsService } from './get-practice-insights.service';
import type { PracticeInsightRow } from '@lib/practice/practice-insights-calculator';
import type {
  PracticeInsights,
  PracticeLocale,
  PracticeRecommendation as RecommendationDto,
} from '../../interfaces/practice/practice-adaptive.interface';
import type {
  PracticeCandidate,
  PracticeRecommendationGenerator,
} from './practice-recommendation-generator';
import type { PracticeRecommendationsRepository } from '@repositories/practice/practice-recommendations.repository';
import {
  PracticeRecommendation,
  PracticeRecommendationStatus,
} from '../../models/PracticeRecommendation';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-08-06T12:00:00Z');

function eligibleRow(attemptId: string, itemSuffix: number): PracticeInsightRow {
  return {
    attemptId,
    submittedAt: NOW,
    durationSeconds: 60,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    skillTags: [`skill-${itemSuffix}`],
    isCorrect: true,
    isUnanswered: false,
  };
}

function eligibleRows(): PracticeInsightRow[] {
  return [0, 1, 2].flatMap((a) => [0, 1, 2, 3, 4].map((i) => eligibleRow(`attempt-${a}`, i)));
}

function fakeInsightsService(rows: PracticeInsightRow[]): GetPracticeInsightsService {
  return new GetPracticeInsightsService({ listRows: async () => rows }, () => NOW);
}

const VALID_RECOMMENDATION: RecommendationDto = {
  summary: 'Keep it up.',
  strengths: ['skill-1'],
  focusAreas: ['skill-0'],
  recommendedPractice: {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    reason: 'r',
  },
  studyTips: ['tip'],
};

type FakeRow = {
  id: string;
  status: PracticeRecommendationStatus;
  recommendation: RecommendationDto | null;
};

class FakeRecommendationsRepository {
  rows = new Map<string, FakeRow>();
  claimCalls = 0;
  private key(userId: string, hash: string, locale: PracticeLocale, version: string) {
    return `${userId}|${hash}|${locale}|${version}`;
  }
  async findReady(userId: string, hash: string, locale: PracticeLocale, version: string) {
    const row = this.rows.get(this.key(userId, hash, locale, version));
    return row && row.status === PracticeRecommendationStatus.READY
      ? (row as unknown as PracticeRecommendation)
      : null;
  }
  async claimPending(userId: string, hash: string, locale: PracticeLocale, version: string) {
    this.claimCalls++;
    const k = this.key(userId, hash, locale, version);
    const existing = this.rows.get(k);
    if (!existing) {
      const row: FakeRow = {
        id: `id-${this.rows.size + 1}`,
        status: PracticeRecommendationStatus.PENDING,
        recommendation: null,
      };
      this.rows.set(k, row);
      return row as unknown as PracticeRecommendation;
    }
    if (existing.status === PracticeRecommendationStatus.FAILED) {
      existing.status = PracticeRecommendationStatus.PENDING;
      existing.recommendation = null;
      return existing as unknown as PracticeRecommendation;
    }
    // ready or an active pending: slot is not claimable
    return null;
  }
  async markReady(id: string, recommendation: RecommendationDto) {
    for (const row of this.rows.values())
      if (row.id === id) {
        row.status = PracticeRecommendationStatus.READY;
        row.recommendation = recommendation;
      }
  }
  async markFailed(id: string) {
    for (const row of this.rows.values())
      if (row.id === id) row.status = PracticeRecommendationStatus.FAILED;
  }
}

function fakeGenerator(
  impl: (
    locale: PracticeLocale,
    insights: PracticeInsights,
    candidates: PracticeCandidate[],
  ) => Promise<RecommendationDto>,
): PracticeRecommendationGenerator {
  return { generate: impl };
}

function buildService(
  repository: Pick<
    PracticeRecommendationsRepository,
    'findReady' | 'claimPending' | 'markReady' | 'markFailed'
  >,
  generator: PracticeRecommendationGenerator,
  rows: PracticeInsightRow[] = eligibleRows(),
) {
  return new GeneratePracticeRecommendationService(
    fakeInsightsService(rows),
    repository,
    generator,
  );
}

describe('GeneratePracticeRecommendationService', () => {
  it('rejects an invalid locale before touching insights or the repository', async () => {
    let called = false;
    const repository = new FakeRecommendationsRepository();
    const insights = new GetPracticeInsightsService(
      {
        listRows: async () => {
          called = true;
          return [];
        },
      },
      () => NOW,
    );
    const service = new GeneratePracticeRecommendationService(
      insights,
      repository,
      fakeGenerator(async () => VALID_RECOMMENDATION),
    );
    await assert.rejects(
      () => service.execute(USER_ID, 'fr' as PracticeLocale),
      (err: unknown) =>
        err instanceof PracticeRecommendationError &&
        err.code === PracticeRecommendationErrorCode.INVALID_INPUT,
    );
    assert.equal(called, false);
  });

  it('returns insufficient_data without calling the AI when there is no data', async () => {
    let generatorCalled = false;
    const service = buildService(
      new FakeRecommendationsRepository(),
      fakeGenerator(async () => {
        generatorCalled = true;
        return VALID_RECOMMENDATION;
      }),
      [],
    );
    const result = await service.execute(USER_ID, 'en');
    assert.equal(result.status, 'insufficient_data');
    assert.equal(result.recommendation, null);
    assert.equal(generatorCalled, false);
  });

  it('returns insufficient_data without calling the AI when below minimum attempts/items', async () => {
    let generatorCalled = false;
    const rows = [eligibleRow('a', 0), eligibleRow('a', 1)];
    const service = buildService(
      new FakeRecommendationsRepository(),
      fakeGenerator(async () => {
        generatorCalled = true;
        return VALID_RECOMMENDATION;
      }),
      rows,
    );
    const result = await service.execute(USER_ID, 'en');
    assert.equal(result.status, 'insufficient_data');
    assert.equal(generatorCalled, false);
  });

  it('returns insufficient_data without calling the AI when no candidate part is generation-supported', async () => {
    let generatorCalled = false;
    const rows = Array.from({ length: 3 }, (_, a) =>
      Array.from({ length: 5 }, (_, i) => ({
        ...eligibleRow(`attempt-${a}`, i),
        partCode: 'READING_PART_9_NOT_SUPPORTED',
      })),
    ).flat();
    const service = buildService(
      new FakeRecommendationsRepository(),
      fakeGenerator(async () => {
        generatorCalled = true;
        return VALID_RECOMMENDATION;
      }),
      rows,
    );
    const result = await service.execute(USER_ID, 'en');
    assert.equal(result.status, 'insufficient_data');
    assert.equal(generatorCalled, false);
  });

  it('calls the AI and marks the recommendation ready on first request', async () => {
    const repository = new FakeRecommendationsRepository();
    let generatorCalls = 0;
    const service = buildService(
      repository,
      fakeGenerator(async () => {
        generatorCalls++;
        return VALID_RECOMMENDATION;
      }),
    );
    const result = await service.execute(USER_ID, 'en');
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.recommendation, VALID_RECOMMENDATION);
    assert.equal(generatorCalls, 1);
  });

  it('reuses a ready recommendation for the same snapshot without calling the AI again', async () => {
    const repository = new FakeRecommendationsRepository();
    let generatorCalls = 0;
    const service = buildService(
      repository,
      fakeGenerator(async () => {
        generatorCalls++;
        return VALID_RECOMMENDATION;
      }),
    );
    await service.execute(USER_ID, 'en');
    const second = await service.execute(USER_ID, 'en');
    assert.equal(second.status, 'ready');
    assert.equal(generatorCalls, 1);
  });

  it('does not duplicate the AI call when a request is already pending (in-flight)', async () => {
    const repository = new FakeRecommendationsRepository();
    let generatorCalls = 0;
    let resolveGenerator: (() => void) | undefined;
    const generator = fakeGenerator(async () => {
      generatorCalls++;
      await new Promise<void>((resolve) => {
        resolveGenerator = resolve;
      });
      return VALID_RECOMMENDATION;
    });
    const service = buildService(repository, generator);
    const first = service.execute(USER_ID, 'en');
    // give the first call time to claim the pending slot before the second starts
    await new Promise((r) => setImmediate(r));
    const second = service.execute(USER_ID, 'en');
    await assert.rejects(
      () => second,
      (err: unknown) =>
        err instanceof PracticeRecommendationError &&
        err.code === PracticeRecommendationErrorCode.RECOMMENDATION_IN_PROGRESS,
    );
    resolveGenerator!();
    const firstResult = await first;
    assert.equal(firstResult.status, 'ready');
    assert.equal(generatorCalls, 1);
  });

  it('lets concurrent requests race the claim; exactly one calls the AI', async () => {
    const repository = new FakeRecommendationsRepository();
    let generatorCalls = 0;
    const generator = fakeGenerator(async () => {
      generatorCalls++;
      return VALID_RECOMMENDATION;
    });
    const service = buildService(repository, generator);
    const results = await Promise.allSettled([
      service.execute(USER_ID, 'en'),
      service.execute(USER_ID, 'en'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(generatorCalls, 1);
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(repository.claimCalls, 2);
  });

  it('allows retrying after a failed generation (does not stay stuck failed)', async () => {
    const repository = new FakeRecommendationsRepository();
    let attempt = 0;
    const generator = fakeGenerator(async () => {
      attempt++;
      if (attempt === 1) throw Object.assign(new Error('boom'), { code: 'provider_error' });
      return VALID_RECOMMENDATION;
    });
    const service = buildService(repository, generator);
    await assert.rejects(
      () => service.execute(USER_ID, 'en'),
      (err: unknown) =>
        err instanceof PracticeRecommendationError &&
        err.code === PracticeRecommendationErrorCode.AI_PROVIDER_UNAVAILABLE,
    );
    const retried = await service.execute(USER_ID, 'en');
    assert.equal(retried.status, 'ready');
    assert.equal(attempt, 2);
  });

  it('returns ready if a recommendation lands concurrently while this request could not claim the slot', async () => {
    const repository = new FakeRecommendationsRepository();
    const key =
      `${USER_ID}|${practiceInsightsSnapshotHash(await fakeInsightsService(eligibleRows()).execute(USER_ID))}|en|` +
      'practice-adaptive-recommendation-v1';
    repository.rows.set(key, {
      id: 'winner',
      status: PracticeRecommendationStatus.PENDING,
      recommendation: null,
    });
    const service = buildService(
      repository,
      fakeGenerator(async () => VALID_RECOMMENDATION),
    );
    const pendingExecute = service.execute(USER_ID, 'en');
    // Simulate the other in-flight request completing before we give up.
    repository.rows.set(key, {
      id: 'winner',
      status: PracticeRecommendationStatus.READY,
      recommendation: VALID_RECOMMENDATION,
    });
    const result = await pendingExecute;
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.recommendation, VALID_RECOMMENDATION);
  });

  const providerErrorCases: Array<{ code: string; expected: PracticeRecommendationErrorCode }> = [
    { code: 'rate_limited', expected: PracticeRecommendationErrorCode.AI_RATE_LIMITED },
    { code: 'timeout', expected: PracticeRecommendationErrorCode.AI_REQUEST_TIMEOUT },
    { code: 'not_configured', expected: PracticeRecommendationErrorCode.AI_CONFIGURATION_ERROR },
    {
      code: 'invalid_json_response',
      expected: PracticeRecommendationErrorCode.AI_INVALID_RESPONSE,
    },
    { code: 'empty_response', expected: PracticeRecommendationErrorCode.AI_INVALID_RESPONSE },
    { code: 'provider_error', expected: PracticeRecommendationErrorCode.AI_PROVIDER_UNAVAILABLE },
    {
      code: 'authentication_failed',
      expected: PracticeRecommendationErrorCode.AI_PROVIDER_UNAVAILABLE,
    },
  ];
  for (const { code, expected } of providerErrorCases) {
    it(`maps provider error code "${code}" to ${expected} and marks the row failed`, async () => {
      const repository = new FakeRecommendationsRepository();
      const generator = fakeGenerator(async () => {
        throw Object.assign(new Error(code), { code });
      });
      const service = buildService(repository, generator);
      await assert.rejects(
        () => service.execute(USER_ID, 'en'),
        (err: unknown) => err instanceof PracticeRecommendationError && err.code === expected,
      );
      const stored = [...repository.rows.values()][0]!;
      assert.equal(stored.status, PracticeRecommendationStatus.FAILED);
    });
  }

  it('propagates AI_INVALID_RESPONSE thrown by the generator for an invented candidate', async () => {
    const repository = new FakeRecommendationsRepository();
    const generator = fakeGenerator(async () => {
      throw new Error('AI_INVALID_RESPONSE');
    });
    const service = buildService(repository, generator);
    await assert.rejects(
      () => service.execute(USER_ID, 'en'),
      (err: unknown) =>
        err instanceof PracticeRecommendationError &&
        err.code === PracticeRecommendationErrorCode.AI_INVALID_RESPONSE,
    );
  });
});
