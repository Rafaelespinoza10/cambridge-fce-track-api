import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  PRACTICE_EXAM_CATALOG,
  isPracticeExamCode,
  isPracticePaperCode,
  isPracticePartCode,
  isPracticeTaskType,
  isPracticeGenerationSupported,
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

  it('B1_PRELIMINARY still has no papers registered (documented gap, not a bug)', () => {
    const pet = findExamInCatalog(PRACTICE_EXAM_CATALOG, 'B1_PRELIMINARY');
    assert.deepEqual(pet?.papers, []);
  });

  it('B2_FIRST has all 4 official papers registered', () => {
    const b2First = findExamInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST');
    assert.deepEqual(
      b2First?.papers.map((paper) => paper.code),
      ['PAPER_1', 'PAPER_2', 'PAPER_3', 'PAPER_4'],
    );
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

  it('isPracticePaperCode, isPracticePartCode and isPracticeTaskType are still false for B1_PRELIMINARY (no papers registered)', () => {
    assert.equal(isPracticePaperCode('B1_PRELIMINARY', 'ANY'), false);
    assert.equal(isPracticePartCode('B1_PRELIMINARY', 'ANY', 'ANY'), false);
    assert.equal(isPracticeTaskType('B1_PRELIMINARY', 'ANY', 'ANY', 'ANY'), false);
  });
});

// ── production catalog: real, verified B2 First structure ──────────────────
// Derived mechanically from src/config/seed/data/exam-sections.ts — not
// invented from memory. See the PRACTICE_EXAM_CATALOG doc comment.

describe('PRACTICE_EXAM_CATALOG — B2 First (verified)', () => {
  it('recognizes Paper 1 and its Use of English parts', () => {
    assert.equal(isPracticePaperCode('B2_FIRST', 'PAPER_1'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'UOE_PART_1'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'UOE_PART_2'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'UOE_PART_3'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'UOE_PART_4'), true);
  });

  it('recognizes the generatable task types for each Use of English part', () => {
    assert.equal(isPracticeTaskType('B2_FIRST', 'PAPER_1', 'UOE_PART_1', 'multiple_choice_cloze'), true);
    assert.equal(isPracticeTaskType('B2_FIRST', 'PAPER_1', 'UOE_PART_2', 'open_cloze'), true);
    assert.equal(isPracticeTaskType('B2_FIRST', 'PAPER_1', 'UOE_PART_3', 'word_formation'), true);
    assert.equal(
      isPracticeTaskType('B2_FIRST', 'PAPER_1', 'UOE_PART_4', 'key_word_transformation'),
      true,
    );
  });

  it('exposes the real per-part item counts for the 4 generatable parts', () => {
    assert.equal(findPartInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST', 'PAPER_1', 'UOE_PART_1')?.defaultItemCount, 8);
    assert.equal(findPartInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST', 'PAPER_1', 'UOE_PART_2')?.defaultItemCount, 8);
    assert.equal(findPartInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST', 'PAPER_1', 'UOE_PART_3')?.defaultItemCount, 8);
    assert.equal(findPartInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST', 'PAPER_1', 'UOE_PART_4')?.defaultItemCount, 6);
  });

  it('recognizes Reading parts 5-7 as real (catalogued) and generation-supported', () => {
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'READING_PART_5'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'READING_PART_6'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'READING_PART_7'), true);
    assert.equal(
      findPartInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST', 'PAPER_1', 'READING_PART_5')
        ?.defaultItemCount,
      6,
    );
  });

  it('recognizes Papers 2-4 (Writing, Listening, Speaking) as real (catalogued)', () => {
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_2', 'WRITING_PART_1'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_3', 'LISTENING_PART_1'), true);
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_4', 'SPEAKING_PART_1'), true);
  });

  it('rejects a part that does not exist in any paper', () => {
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_1', 'UOE_PART_5'), false);
  });

  it('rejects a real part code under the wrong paper', () => {
    assert.equal(isPracticePartCode('B2_FIRST', 'PAPER_2', 'UOE_PART_1'), false);
  });
});

// ── generationSupported ──────────────────────────────────────────────────────

const B2_FIRST_UOE_PARTS = ['UOE_PART_1', 'UOE_PART_2', 'UOE_PART_3', 'UOE_PART_4'];
const B2_FIRST_READING_PARTS = ['READING_PART_5', 'READING_PART_6', 'READING_PART_7'];
const B2_FIRST_GENERATABLE_PAPER_1_PARTS = [...B2_FIRST_UOE_PARTS, ...B2_FIRST_READING_PARTS];

describe('isPracticeGenerationSupported', () => {
  it('is true for the 4 Use of English parts and the 3 Reading parts', () => {
    for (const partCode of B2_FIRST_GENERATABLE_PAPER_1_PARTS) {
      assert.equal(
        isPracticeGenerationSupported('B2_FIRST', 'PAPER_1', partCode),
        true,
        `expected ${partCode} to be generation-supported`,
      );
    }
  });

  it('is false for every other real, catalogued B2 First part', () => {
    const b2First = findExamInCatalog(PRACTICE_EXAM_CATALOG, 'B2_FIRST');
    assert.ok(b2First);

    let checked = 0;
    for (const paper of b2First.papers) {
      for (const part of paper.parts) {
        if (paper.code === 'PAPER_1' && B2_FIRST_GENERATABLE_PAPER_1_PARTS.includes(part.code)) {
          continue;
        }
        checked += 1;
        assert.equal(
          isPracticeGenerationSupported('B2_FIRST', paper.code, part.code),
          false,
          `expected ${paper.code}/${part.code} to NOT be generation-supported`,
        );
      }
    }
    // Sanity: makes sure this test actually exercised every non-generatable
    // part (2 Writing + 4 Listening + 4 Speaking = 10).
    assert.equal(checked, 10);
  });

  it('is false for an unknown exam/paper/part', () => {
    assert.equal(isPracticeGenerationSupported('NOT_AN_EXAM', 'PAPER_1', 'UOE_PART_1'), false);
    assert.equal(isPracticeGenerationSupported('B2_FIRST', 'NOT_A_PAPER', 'UOE_PART_1'), false);
    assert.equal(isPracticeGenerationSupported('B2_FIRST', 'PAPER_1', 'NOT_A_PART'), false);
  });

  it('B1_PRELIMINARY has no generation-supported parts (no papers registered at all)', () => {
    const pet = findExamInCatalog(PRACTICE_EXAM_CATALOG, 'B1_PRELIMINARY');
    assert.deepEqual(pet?.papers, []);
  });
});
