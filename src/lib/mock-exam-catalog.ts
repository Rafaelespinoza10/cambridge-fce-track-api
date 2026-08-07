import { ExamType } from '../models/enums';

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
 */
export const MOCK_EXAM_CATALOG: Readonly<Record<ExamType, MockExamCatalogEntry>> = {
  [ExamType.B2_FIRST]: {
    scoreScale: 'CAMBRIDGE_ENGLISH_SCALE',
    sections: [
      { code: 'READING', name: 'Reading', defaultMaxScore: 30 },
      { code: 'USE_OF_ENGLISH', name: 'Use of English', defaultMaxScore: 28 },
      { code: 'WRITING', name: 'Writing', defaultMaxScore: 40 },
      { code: 'LISTENING', name: 'Listening', defaultMaxScore: 30 },
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
