import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculatePracticeInsights } from './practice-insights-calculator';
import type { PracticeInsightRow } from './practice-insights-calculator';

const NOW = new Date('2026-08-06T12:00:00Z');

const row = (
  id: string,
  overrides: Partial<PracticeInsightRow> = {},
): PracticeInsightRow => ({
  attemptId: id,
  submittedAt: NOW,
  durationSeconds: 60,
  examCode: 'B2_FIRST',
  paperCode: 'PAPER_1',
  partCode: 'UOE_PART_1',
  skillTags: ['tag-1'],
  isCorrect: true,
  isUnanswered: false,
  ...overrides,
});

describe('calculatePracticeInsights', () => {
  it('returns a zeroed, ineligible result for no data', () => {
    const result = calculatePracticeInsights([], NOW);
    assert.deepEqual(result.sample, {
      attemptCount: 0,
      itemCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      unansweredCount: 0,
    });
    assert.equal(result.overall.percentage, 0);
    assert.equal(result.overall.averageDurationSeconds, null);
    assert.deepEqual(result.byPart, []);
    assert.deepEqual(result.bySkill, []);
    assert.deepEqual(result.strengths, []);
    assert.deepEqual(result.focusAreas, []);
    assert.equal(result.trend, null);
    assert.equal(result.eligibleForRecommendation, false);
  });

  it('is ineligible below the minimum 3 attempts even with enough items', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => row(`a-item-${i}`, { attemptId: 'attempt-a' })),
      ...Array.from({ length: 8 }, (_, i) => row(`b-item-${i}`, { attemptId: 'attempt-b' })),
    ];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 2);
    assert.equal(result.sample.itemCount, 16);
    assert.equal(result.eligibleForRecommendation, false);
  });

  it('is ineligible below the minimum 15 items even with enough attempts', () => {
    const rows = [row('a', {}), row('b', {}), row('c', {})];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 3);
    assert.equal(result.sample.itemCount, 3);
    assert.equal(result.eligibleForRecommendation, false);
  });

  it('becomes eligible once >= 3 attempts and >= 15 items are both met', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      Array.from({ length: 5 }, (_, j) => row(`a-${i}`, { attemptId: `a-${i}`, skillTags: [`s-${j}`] })),
    ).flat();
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 3);
    assert.equal(result.sample.itemCount, 15);
    assert.equal(result.eligibleForRecommendation, true);
  });

  it('calculates deterministic counts, percentages and stable ordering', () => {
    const result = calculatePracticeInsights(
      [
        row('a', { partCode: 'UOE_PART_2', skillTags: ['tag-2'], isCorrect: false }),
        { ...row('a', { skillTags: ['tag-1'] }), isCorrect: true },
        { ...row('a', { skillTags: ['tag-1'] }), isCorrect: false, isUnanswered: true },
      ],
      NOW,
    );
    assert.deepEqual(result.sample, {
      attemptCount: 1,
      itemCount: 3,
      correctCount: 1,
      incorrectCount: 1,
      unansweredCount: 1,
    });
    assert.equal(result.overall.percentage, 33.33);
    assert.equal(result.overall.averageDurationSeconds, 60);
    assert.deepEqual(result.focusAreas, ['tag-2', 'tag-1']);
    assert.equal(result.strengths[0], 'tag-1');
  });

  it('rounds percentages to two decimals', () => {
    const rows = [row('a', { isCorrect: true }), row('b', { isCorrect: false }), row('c', { isCorrect: false })];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.overall.percentage, 33.33);
  });

  it('produces a stable byPart/bySkill order for equal percentages via code tie-breaks', () => {
    const rows = [
      row('a', { partCode: 'UOE_PART_2', skillTags: ['b-skill'], isCorrect: true }),
      row('b', { partCode: 'UOE_PART_1', skillTags: ['a-skill'], isCorrect: true }),
    ];
    const result = calculatePracticeInsights(rows, NOW);
    assert.deepEqual(
      result.byPart.map((p) => p.partCode),
      ['UOE_PART_1', 'UOE_PART_2'],
    );
    assert.deepEqual(
      result.bySkill.map((s) => s.code),
      ['a-skill', 'b-skill'],
    );
  });

  it('deduplicates repeated skill tags within a single item', () => {
    const rows = [row('a', { skillTags: ['tag-1', 'tag-1', 'tag-1'] })];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.bySkill.length, 1);
    assert.equal(result.bySkill[0]!.itemCount, 1);
  });

  it('counts unanswered items separately from incorrect ones', () => {
    const rows = [
      row('a', { isCorrect: false, isUnanswered: true }),
      row('b', { isCorrect: false, isUnanswered: false }),
      row('c', { isCorrect: true }),
    ];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.unansweredCount, 1);
    assert.equal(result.sample.incorrectCount, 1);
    assert.equal(result.sample.correctCount, 1);
    assert.equal(result.overall.percentage, 33.33);
  });

  it('keeps only the newest ten attempts in the last thirty days', () => {
    // 11 distinct-timestamp attempts, oldest (i=0, the only correct one)
    // must be the one dropped by the ten-attempt cap.
    const rows = Array.from({ length: 11 }, (_, i) =>
      row(String(i), {
        isCorrect: i === 0,
        submittedAt: new Date(NOW.getTime() - (10 - i) * 1000),
      }),
    );
    rows.push(row('old', { isCorrect: true, submittedAt: new Date('2026-07-01T12:00:00Z') }));
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 10);
    assert.equal(result.sample.correctCount, 0);
  });

  it('breaks ties deterministically by attemptId when timestamps are identical', () => {
    const rowsA = [row('b', { attemptId: 'b' }), row('a', { attemptId: 'a' })];
    const rowsB = [row('a', { attemptId: 'a' }), row('b', { attemptId: 'b' })];
    const resultA = calculatePracticeInsights(rowsA, NOW);
    const resultB = calculatePracticeInsights(rowsB, NOW);
    assert.deepEqual(resultA, resultB);
  });

  it('excludes attempts older than thirty days even when under the ten-attempt cap', () => {
    const rows = [
      row('recent-1', { submittedAt: NOW }),
      row('recent-2', { submittedAt: NOW }),
      row('too-old', { submittedAt: new Date('2026-07-06T11:59:59Z') }),
    ];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 2);
  });

  it('includes an attempt exactly at the thirty-day boundary', () => {
    const boundary = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = [row('a', { submittedAt: boundary })];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 1);
  });

  it('has no trend with fewer than six windowed attempts', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`a-${i}`));
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.trend, null);
  });

  it('computes trend direction from the three most recent vs the previous three windowed attempts', () => {
    const rows = [
      row('r1', { submittedAt: new Date('2026-08-06T12:00:00Z'), isCorrect: true }),
      row('r2', { submittedAt: new Date('2026-08-05T12:00:00Z'), isCorrect: true }),
      row('r3', { submittedAt: new Date('2026-08-04T12:00:00Z'), isCorrect: true }),
      row('p1', { submittedAt: new Date('2026-08-03T12:00:00Z'), isCorrect: false }),
      row('p2', { submittedAt: new Date('2026-08-02T12:00:00Z'), isCorrect: false }),
      row('p3', { submittedAt: new Date('2026-08-01T12:00:00Z'), isCorrect: false }),
    ];
    const result = calculatePracticeInsights(rows, NOW);
    assert.ok(result.trend);
    assert.equal(result.trend!.recentPercentage, 100);
    assert.equal(result.trend!.previousPercentage, 0);
    assert.equal(result.trend!.deltaPercentage, 100);
    assert.equal(result.trend!.direction, 'improving');
  });

  it('reports a stable trend when there is no percentage change', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`a-${i}`, {
        submittedAt: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
        isCorrect: true,
      }),
    );
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.trend!.direction, 'stable');
    assert.equal(result.trend!.deltaPercentage, 0);
  });

  it('does not let trend look outside the thirty-day / ten-attempt window', () => {
    // 4 recent attempts inside the window (all correct) + several very old
    // attempts (all incorrect) that fall outside the 30-day window. Trend
    // must not have enough windowed attempts to compute, even though the
    // all-time attempt count is >= 6.
    const rows = [
      ...Array.from({ length: 4 }, (_, i) =>
        row(`recent-${i}`, { submittedAt: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000), isCorrect: true }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        row(`old-${i}`, {
          submittedAt: new Date('2026-01-01T00:00:00Z'),
          isCorrect: false,
        }),
      ),
    ];
    const result = calculatePracticeInsights(rows, NOW);
    assert.equal(result.sample.attemptCount, 4);
    assert.equal(result.trend, null);
  });

  it('produces the same hash-relevant shape (deterministic) for the same input regardless of row order', () => {
    const rowsA = [
      row('a', { partCode: 'UOE_PART_1', skillTags: ['s1'] }),
      row('b', { partCode: 'UOE_PART_2', skillTags: ['s2'], isCorrect: false }),
    ];
    const rowsB = [rowsA[1]!, rowsA[0]!];
    const resultA = calculatePracticeInsights(rowsA, NOW);
    const resultB = calculatePracticeInsights(rowsB, NOW);
    assert.deepEqual(resultA.byPart, resultB.byPart);
    assert.deepEqual(resultA.bySkill, resultB.bySkill);
  });

  it('changes when relevant data is added', () => {
    const rows = [row('a', { isCorrect: true })];
    const before = calculatePracticeInsights(rows, NOW);
    const after = calculatePracticeInsights([...rows, row('b', { isCorrect: false })], NOW);
    assert.notEqual(before.overall.percentage, after.overall.percentage);
    assert.notEqual(before.sample.itemCount, after.sample.itemCount);
  });
});
