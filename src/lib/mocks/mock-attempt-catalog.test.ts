import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  MOCK_ATTEMPT_SECTION_CATALOG,
  findMockAttemptSectionCatalogEntry,
} from './mock-attempt-catalog';
import { MOCK_EXAM_CATALOG } from './mock-exam-catalog';
import { isPracticePartCode, isPracticeGenerationSupported } from '@lib/practice/practice-exam-catalog';
import { ExamType, MockAttemptSectionContentType } from '@models/enums';

describe('MOCK_ATTEMPT_SECTION_CATALOG', () => {
  it('has exactly 13 sections (every B2_FIRST MOCK_EXAM_CATALOG section except SPEAKING)', () => {
    assert.equal(MOCK_ATTEMPT_SECTION_CATALOG.length, 13);
  });

  it('every sectionCode matches a real MOCK_EXAM_CATALOG[B2_FIRST] section code', () => {
    const realCodes = new Set(MOCK_EXAM_CATALOG[ExamType.B2_FIRST].sections.map((s) => s.code));
    for (const entry of MOCK_ATTEMPT_SECTION_CATALOG) {
      assert.ok(realCodes.has(entry.sectionCode), `${entry.sectionCode} not in MOCK_EXAM_CATALOG`);
    }
    assert.equal(MOCK_ATTEMPT_SECTION_CATALOG.some((e) => e.sectionCode === 'SPEAKING'), false);
  });

  it('every practice_exercise section is a real, generation-supported PRACTICE_EXAM_CATALOG part', () => {
    for (const entry of MOCK_ATTEMPT_SECTION_CATALOG) {
      if (entry.contentType !== MockAttemptSectionContentType.PRACTICE_EXERCISE) continue;
      assert.ok(isPracticePartCode('B2_FIRST', entry.paperCode, entry.partCode));
      assert.ok(isPracticeGenerationSupported('B2_FIRST', entry.paperCode, entry.partCode));
    }
  });

  it('every writing_task section has at least one WritingTaskType', () => {
    for (const entry of MOCK_ATTEMPT_SECTION_CATALOG) {
      if (entry.contentType !== MockAttemptSectionContentType.WRITING_TASK) continue;
      assert.ok((entry.writingTaskTypes?.length ?? 0) > 0);
    }
  });

  it('every listening section has no taskType/writingTaskTypes (curated, not generated)', () => {
    for (const entry of MOCK_ATTEMPT_SECTION_CATALOG) {
      if (entry.contentType !== MockAttemptSectionContentType.LISTENING) continue;
      assert.equal(entry.taskType, undefined);
      assert.equal(entry.writingTaskTypes, undefined);
    }
  });

  it('every section has a positive default duration', () => {
    for (const entry of MOCK_ATTEMPT_SECTION_CATALOG) {
      assert.ok(entry.defaultDurationMinutes > 0, `${entry.sectionCode} has a non-positive duration`);
    }
  });

  it('findMockAttemptSectionCatalogEntry finds a real section and rejects an unknown one', () => {
    assert.ok(findMockAttemptSectionCatalogEntry('uoe-part-1'));
    assert.equal(findMockAttemptSectionCatalogEntry('not-a-real-section'), undefined);
  });
});
