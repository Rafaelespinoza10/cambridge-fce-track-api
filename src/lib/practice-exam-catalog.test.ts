import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  PRACTICE_EXAM_CATALOG,
  isPracticeExamCode,
  isPracticePaperCode,
  isPracticePartCode,
  isPracticeTaskType,
  findExamInCatalog,
  findPaperInCatalog,
  findPartInCatalog,
  findTaskTypeInCatalog,
} from './practice-exam-catalog';
import type { PracticeExamCatalogEntry } from './practice-exam-catalog';

// Fixture-only catalog, not real Cambridge content — exercises the generic
// catalog engine (paper/part/task-type lookups) without fabricating
// unverified exam metadata in the production catalog.
const FIXTURE_CATALOG: readonly PracticeExamCatalogEntry[] = [
  {
    code: 'FIXTURE_EXAM',
    label: 'Fixture Exam',
    papers: [
      {
        code: 'FIXTURE_PAPER',
        label: 'Fixture Paper',
        parts: [
          {
            code: 'FIXTURE_PART',
            label: 'Fixture Part',
            taskTypes: [{ code: 'fixture_task_type', label: 'Fixture Task Type' }],
          },
        ],
      },
    ],
  },
];

// ── production catalog: exam codes ──────────────────────────────────────────

describe('PRACTICE_EXAM_CATALOG — exam codes', () => {
  it('recognizes B2_FIRST (reused from TargetExam)', () => {
    assert.equal(isPracticeExamCode('B2_FIRST'), true);
  });

  it('recognizes B1_PRELIMINARY', () => {
    assert.equal(isPracticeExamCode('B1_PRELIMINARY'), true);
  });

  it('rejects an unknown exam code', () => {
    assert.equal(isPracticeExamCode('C1_ADVANCED'), false);
  });

  it('ships with no papers registered yet (documented gap, not a bug)', () => {
    for (const exam of PRACTICE_EXAM_CATALOG) {
      assert.deepEqual(exam.papers, []);
    }
  });

  it('does not allow mutating the catalog', () => {
    assert.throws(() => {
      (PRACTICE_EXAM_CATALOG as PracticeExamCatalogEntry[]).push({
        code: 'HACKED',
        label: 'x',
        papers: [],
      });
    });
    assert.throws(() => {
      (PRACTICE_EXAM_CATALOG[0] as { code: string }).code = 'MUTATED';
    });
  });
});

// ── generic catalog engine (fixture data) ───────────────────────────────────

describe('catalog engine — paper/part/task-type lookups', () => {
  it('finds a valid paper for a valid exam', () => {
    assert.ok(findPaperInCatalog(FIXTURE_CATALOG, 'FIXTURE_EXAM', 'FIXTURE_PAPER'));
  });

  it('rejects an invalid paper for a valid exam', () => {
    assert.equal(findPaperInCatalog(FIXTURE_CATALOG, 'FIXTURE_EXAM', 'NOT_A_PAPER'), undefined);
  });

  it('rejects any paper for an invalid exam', () => {
    assert.equal(findPaperInCatalog(FIXTURE_CATALOG, 'NOT_AN_EXAM', 'FIXTURE_PAPER'), undefined);
  });

  it('finds a valid part for a valid paper', () => {
    assert.ok(findPartInCatalog(FIXTURE_CATALOG, 'FIXTURE_EXAM', 'FIXTURE_PAPER', 'FIXTURE_PART'));
  });

  it('rejects an invalid part for a valid paper', () => {
    assert.equal(
      findPartInCatalog(FIXTURE_CATALOG, 'FIXTURE_EXAM', 'FIXTURE_PAPER', 'NOT_A_PART'),
      undefined,
    );
  });

  it('finds a valid task type for a valid part', () => {
    assert.ok(
      findTaskTypeInCatalog(
        FIXTURE_CATALOG,
        'FIXTURE_EXAM',
        'FIXTURE_PAPER',
        'FIXTURE_PART',
        'fixture_task_type',
      ),
    );
  });

  it('rejects an invalid task type for a valid part', () => {
    assert.equal(
      findTaskTypeInCatalog(
        FIXTURE_CATALOG,
        'FIXTURE_EXAM',
        'FIXTURE_PAPER',
        'FIXTURE_PART',
        'not_a_task_type',
      ),
      undefined,
    );
  });

  it('reuses existing codes correctly (findExamInCatalog on the real catalog)', () => {
    const exam = findExamInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST');
    assert.equal(exam?.label, 'B2 First (FCE)');
  });
});

// Sanity check that the exported production wrappers behave the same as the
// generic engine functions they delegate to.
describe('production wrappers delegate to the generic engine', () => {
  it('isPracticeExamCode matches findExamInCatalog', () => {
    assert.equal(isPracticeExamCode('B2_FIRST'), findExamInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST') !== undefined);
  });

  it('isPracticePaperCode, isPracticePartCode and isPracticeTaskType are false with no papers registered', () => {
    assert.equal(isPracticePaperCode('B2_FIRST', 'ANY'), false);
    assert.equal(isPracticePartCode('B2_FIRST', 'ANY', 'ANY'), false);
    assert.equal(isPracticeTaskType('B2_FIRST', 'ANY', 'ANY', 'ANY'), false);
  });
});
