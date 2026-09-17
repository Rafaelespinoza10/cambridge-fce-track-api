import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import { resolveWeakestExamPart } from './resolve-weakest-exam-part';

interface Row {
  sectionSlug: string;
  sectionName: string;
  skillSlug: string;
  skillName: string;
  completedAttempts: number;
  correctCount: number | null;
  totalCount: number | null;
  averageScore: number;
  lastAttemptAt: Date;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    sectionSlug: 'uoe-part-3',
    sectionName: 'Use of English Part 3',
    skillSlug: 'use-of-english',
    skillName: 'Use of English',
    completedAttempts: 5,
    correctCount: 4,
    totalCount: 8,
    averageScore: 50,
    lastAttemptAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

/** getExamPartMetrics is a raw query, so the fake only needs `query`. */
function makeDataSource(rows: Row[]): DataSource {
  return { query: async () => rows } as unknown as DataSource;
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

describe('resolveWeakestExamPart', () => {
  it('returns the lowest-scoring part', async () => {
    const result = await resolveWeakestExamPart(
      makeDataSource([
        row({ sectionSlug: 'reading-part-5', averageScore: 70 }),
        row({ sectionSlug: 'uoe-part-3', averageScore: 40 }),
        row({ sectionSlug: 'reading-part-6', averageScore: 65 }),
      ]),
      USER_ID,
    );

    assert.equal(result?.sectionSlug, 'uoe-part-3');
    assert.equal(result?.averageScore, 40);
  });

  it('ignores a part with too little evidence to call it weak', async () => {
    // 20% looks terrible, but one attempt is noise — sending the learner to
    // grind a part they had a single bad day on would be worse than nothing.
    const result = await resolveWeakestExamPart(
      makeDataSource([
        row({ sectionSlug: 'uoe-part-1', averageScore: 20, completedAttempts: 1 }),
        row({ sectionSlug: 'reading-part-5', averageScore: 60, completedAttempts: 4 }),
      ]),
      USER_ID,
    );

    assert.equal(result?.sectionSlug, 'reading-part-5');
  });

  it('returns null when nothing is weak enough to redirect a session to', async () => {
    const result = await resolveWeakestExamPart(
      makeDataSource([
        row({ sectionSlug: 'uoe-part-1', averageScore: 85 }),
        row({ sectionSlug: 'reading-part-5', averageScore: 92 }),
      ]),
      USER_ID,
    );

    assert.equal(result, null);
  });

  it('returns null for a learner with no history at all', async () => {
    const result = await resolveWeakestExamPart(makeDataSource([]), USER_ID);
    assert.equal(result, null);
  });

  it('breaks a tie toward the better-evidenced part', async () => {
    const result = await resolveWeakestExamPart(
      makeDataSource([
        row({ sectionSlug: 'uoe-part-1', averageScore: 55, completedAttempts: 2 }),
        row({ sectionSlug: 'uoe-part-2', averageScore: 55, completedAttempts: 9 }),
      ]),
      USER_ID,
    );

    assert.equal(result?.sectionSlug, 'uoe-part-2');
  });
});
