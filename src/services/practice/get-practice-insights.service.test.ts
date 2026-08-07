import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GetPracticeInsightsService } from './get-practice-insights.service';

describe('GetPracticeInsightsService', () => {
  it('requests rows scoped to the caller and a thirty-day lookback from now', async () => {
    let seenUserId: string | undefined;
    let seenSince: Date | undefined;
    const now = new Date('2026-08-06T12:00:00Z');
    const service = new GetPracticeInsightsService(
      {
        listRows: async (userId, since) => {
          seenUserId = userId;
          seenSince = since;
          return [];
        },
      },
      () => now,
    );
    await service.execute('user-42');
    assert.equal(seenUserId, 'user-42');
    assert.equal(seenSince!.getTime(), now.getTime() - 30 * 24 * 60 * 60 * 1000);
  });

  it('never calls anything AI-related — it only aggregates repository rows', async () => {
    const service = new GetPracticeInsightsService({ listRows: async () => [] });
    const result = await service.execute('user-1');
    assert.equal(result.eligibleForRecommendation, false);
  });
});
