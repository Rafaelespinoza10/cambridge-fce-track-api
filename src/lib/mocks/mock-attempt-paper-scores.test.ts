import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import type { MockAttemptPaperGroup, MockAttemptPaperScoreDto } from './mock-attempt-paper-scores';
import { computeCoveredOverallPercentage } from './mock-attempt-paper-scores';

function scores(
  overrides: Partial<Record<MockAttemptPaperGroup, number | null>>,
): Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> {
  const toDto = (percentage: number | null): MockAttemptPaperScoreDto => ({
    rawScore: 0,
    maxScore: 0,
    percentage,
  });
  return {
    reading: toDto(overrides.reading ?? null),
    useOfEnglish: toDto(overrides.useOfEnglish ?? null),
    writing: toDto(overrides.writing ?? null),
    listening: toDto(overrides.listening ?? null),
  };
}

describe('computeCoveredOverallPercentage', () => {
  it('averages all 4 groups for a full mock', () => {
    const result = computeCoveredOverallPercentage(
      scores({ reading: 80, useOfEnglish: 60, writing: 75, listening: 90 }),
    );
    assert.equal(result, (80 + 60 + 75 + 90) / 4);
  });

  it('averages only the covered group(s) for a scoped mock, never padding a missing one with 0', () => {
    const result = computeCoveredOverallPercentage(scores({ writing: 75 }));
    assert.equal(result, 75);
  });

  it('averages exactly the groups that were covered when more than one but not all were', () => {
    const result = computeCoveredOverallPercentage(scores({ useOfEnglish: 60, reading: 80 }));
    assert.equal(result, (60 + 80) / 2);
  });

  it('returns null when nothing at all was covered', () => {
    const result = computeCoveredOverallPercentage(scores({}));
    assert.equal(result, null);
  });
});
