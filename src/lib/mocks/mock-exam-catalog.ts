import { ExamType } from '@models/enums';

export type MockScoreScale =
  | 'CAMBRIDGE_ENGLISH_SCALE'
  | 'IELTS_BAND'
  | 'TOEFL_IBT_1_TO_6';

export interface MockExamSectionCatalogEntry {
  code: string;
  name: string;
  defaultMaxScore: number | null;
}

export interface MockExamCatalogEntry {
  scoreScale: MockScoreScale;
  sections: readonly MockExamSectionCatalogEntry[];
}

/**
 * The only source of truth for mock sections. These are high-level reporting
 * components, deliberately separate from the task-level Practice catalogue.
 *
 * B2_FIRST is the one exam type with real per-part granularity: its 13
 * codes below are deliberately kept string-equal to `exam_sections.slug`
 * (src/config/seed/data/exam-sections.ts) — resolveExamSectionIds
 * (mocks.repository.ts) matches them by plain equality, so if that seed
 * data ever changes, this list must be updated too. Speaking stays one
 * holistic entry (code 'SPEAKING', not a real exam_sections slug) because
 * Cambridge Speaking is graded via analytic criteria across the whole
 * test, not additive per-part points — exam_sections has no max_score for
 * any Speaking part, only this app's own synthetic 40-point paper total.
 */
export const MOCK_EXAM_CATALOG: Readonly<Record<ExamType, MockExamCatalogEntry>> = {
  [ExamType.B2_FIRST]: {
    scoreScale: 'CAMBRIDGE_ENGLISH_SCALE',
    sections: [
      { code: 'uoe-part-1', name: 'Part 1 - Multiple Choice Cloze', defaultMaxScore: 8 },
      { code: 'uoe-part-2', name: 'Part 2 - Open Cloze', defaultMaxScore: 8 },
      { code: 'uoe-part-3', name: 'Part 3 - Word Formation', defaultMaxScore: 8 },
      { code: 'uoe-part-4', name: 'Part 4 - Key Word Transformation', defaultMaxScore: 12 },
      { code: 'reading-part-5', name: 'Part 5 - Multiple Choice', defaultMaxScore: 6 },
      { code: 'reading-part-6', name: 'Part 6 - Gapped Text', defaultMaxScore: 6 },
      { code: 'reading-part-7', name: 'Part 7 - Multiple Matching', defaultMaxScore: 10 },
      { code: 'writing-part-1', name: 'Part 1 - Essay', defaultMaxScore: 20 },
      { code: 'writing-part-2', name: 'Part 2 - Situational Writing', defaultMaxScore: 20 },
      { code: 'listening-part-1', name: 'Part 1 - Multiple Choice', defaultMaxScore: 8 },
      { code: 'listening-part-2', name: 'Part 2 - Sentence Completion', defaultMaxScore: 10 },
      { code: 'listening-part-3', name: 'Part 3 - Multiple Matching', defaultMaxScore: 5 },
      { code: 'listening-part-4', name: 'Part 4 - Multiple Choice Interview', defaultMaxScore: 7 },
      { code: 'SPEAKING', name: 'Speaking', defaultMaxScore: 40 },
    ],
  },
  [ExamType.C1_ADVANCED]: {
    scoreScale: 'CAMBRIDGE_ENGLISH_SCALE',
    sections: [
      { code: 'READING_AND_USE_OF_ENGLISH', name: 'Reading and Use of English', defaultMaxScore: 56 },
      { code: 'WRITING', name: 'Writing', defaultMaxScore: null },
      { code: 'LISTENING', name: 'Listening', defaultMaxScore: 30 },
      { code: 'SPEAKING', name: 'Speaking', defaultMaxScore: null },
    ],
  },
  [ExamType.IELTS]: {
    scoreScale: 'IELTS_BAND',
    sections: [
      { code: 'LISTENING', name: 'Listening', defaultMaxScore: 40 },
      { code: 'READING', name: 'Reading', defaultMaxScore: 40 },
      { code: 'WRITING', name: 'Writing', defaultMaxScore: null },
      { code: 'SPEAKING', name: 'Speaking', defaultMaxScore: null },
    ],
  },
  [ExamType.TOEFL]: {
    scoreScale: 'TOEFL_IBT_1_TO_6',
    sections: [
      { code: 'READING', name: 'Reading', defaultMaxScore: null },
      { code: 'LISTENING', name: 'Listening', defaultMaxScore: null },
      { code: 'SPEAKING', name: 'Speaking', defaultMaxScore: null },
      { code: 'WRITING', name: 'Writing', defaultMaxScore: null },
    ],
  },
};

export function getMockExamCatalog(examType: ExamType): MockExamCatalogEntry {
  return MOCK_EXAM_CATALOG[examType];
}

export function getMockExamSection(
  examType: ExamType,
  sectionCode: string,
): MockExamSectionCatalogEntry | undefined {
  return getMockExamCatalog(examType).sections.find((section) => section.code === sectionCode);
}

export function findMockExamSectionByName(
  examType: ExamType,
  sectionName: string,
): MockExamSectionCatalogEntry | undefined {
  const normalized = sectionName.trim().toLocaleLowerCase();
  return getMockExamCatalog(examType).sections.find(
    (section) =>
      section.code === sectionName || section.name.toLocaleLowerCase() === normalized,
  );
}
