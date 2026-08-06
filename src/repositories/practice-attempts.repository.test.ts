import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { toHistoryRow } from './practice-attempts.repository';
import type { PracticeAttemptHistoryRawRow } from './practice-attempts.repository';
import { PracticeAttemptStatus } from '../models/enums';

// This is a pure raw->row mapping function — no DB required — so it's
// tested directly here rather than through the (DB-only) real-Postgres
// validation pass. The point of these tests is TYPE normalization, not just
// value correctness: node-postgres returns `integer` columns as `number`
// but `numeric`/`decimal` columns (percentage) as `string`, and a raw query
// builder result never enforces either shape at compile time. Every case
// below asserts `typeof` on the mapped output, not merely `assert.equal`
// value comparisons that `assert.equal('6', 6)` would pass loosely.

function makeRawRow(
  overrides: Partial<PracticeAttemptHistoryRawRow> = {},
): PracticeAttemptHistoryRawRow {
  return {
    attemptId: 'attempt-1',
    exerciseId: 'exercise-1',
    status: PracticeAttemptStatus.COMPLETED,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    submittedAt: new Date('2026-01-01T00:05:00Z'),
    durationSeconds: 300,
    correctCount: 6,
    totalCount: 8,
    percentage: '75.00',
    feedbackSummary: {
      version: 'practice-attempt-feedback-v1',
      unansweredCount: 1,
      skillBreakdown: [],
    },
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    targetLevel: null,
    title: 'Multiple Choice Cloze',
    itemCount: 8,
    ...overrides,
  };
}

describe('toHistoryRow — numeric type normalization', () => {
  it('converts a string percentage (numeric/decimal column) to a real number', () => {
    const row = toHistoryRow(makeRawRow({ percentage: '75.00' }));
    assert.equal(typeof row.percentage, 'number');
    assert.equal(row.percentage, 75);
  });

  it('preserves a null percentage as null, not "0" or NaN', () => {
    const row = toHistoryRow(makeRawRow({ percentage: null }));
    assert.equal(row.percentage, null);
  });

  it('normalizes durationSeconds to a number even if the driver hands back a string', () => {
    const row = toHistoryRow(makeRawRow({ durationSeconds: '300' }));
    assert.equal(typeof row.durationSeconds, 'number');
    assert.equal(row.durationSeconds, 300);
  });

  it('preserves a null durationSeconds as null', () => {
    const row = toHistoryRow(makeRawRow({ durationSeconds: null }));
    assert.equal(row.durationSeconds, null);
  });

  it('normalizes correctCount to a number even if the driver hands back a string', () => {
    const row = toHistoryRow(makeRawRow({ correctCount: '6' }));
    assert.equal(typeof row.correctCount, 'number');
    assert.equal(row.correctCount, 6);
  });

  it('preserves a null correctCount as null', () => {
    const row = toHistoryRow(makeRawRow({ correctCount: null }));
    assert.equal(row.correctCount, null);
  });

  it('normalizes totalCount to a number even if the driver hands back a string', () => {
    const row = toHistoryRow(makeRawRow({ totalCount: '8' }));
    assert.equal(typeof row.totalCount, 'number');
    assert.equal(row.totalCount, 8);
  });

  it('normalizes itemCount to a number even if the driver hands back a string', () => {
    const row = toHistoryRow(makeRawRow({ itemCount: '8' }));
    assert.equal(typeof row.itemCount, 'number');
    assert.equal(row.itemCount, 8);
  });

  it('leaves already-numeric fields as numbers (no accidental stringification)', () => {
    const row = toHistoryRow(
      makeRawRow({
        durationSeconds: 120,
        correctCount: 5,
        totalCount: 8,
        itemCount: 8,
        percentage: 62.5,
      }),
    );
    assert.equal(typeof row.durationSeconds, 'number');
    assert.equal(typeof row.correctCount, 'number');
    assert.equal(typeof row.totalCount, 'number');
    assert.equal(typeof row.itemCount, 'number');
    assert.equal(typeof row.percentage, 'number');
  });

  it('every numeric-ish field on a fully-populated completed row is typeof number (or null)', () => {
    const row = toHistoryRow(makeRawRow());
    for (const field of [
      'itemCount',
      'durationSeconds',
      'correctCount',
      'totalCount',
      'percentage',
    ] as const) {
      assert.equal(typeof row[field], 'number', `${field} should be typeof number`);
    }
  });

  it('leaves startedAt/submittedAt as real Date instances, not strings', () => {
    const row = toHistoryRow(makeRawRow());
    assert.ok(row.startedAt instanceof Date);
    assert.ok(row.submittedAt instanceof Date);
  });
});
