import { MockAttemptSectionContentType, WritingTaskType } from '@models/enums';

/**
 * Single source of truth for what a live, timed full-mock section actually
 * is — which MOCK_EXAM_CATALOG section code (mock-exam-catalog.ts) maps to
 * which content-generation mechanism, which real exam/paper/part code that
 * generation call needs, how long the section's timer runs, and which of the
 * 4 MockTest score fields it rolls up into. Deliberately separate from
 * MOCK_EXAM_CATALOG (that one is the historical reporting catalog used by
 * manual mock registration) and from PRACTICE_EXAM_CATALOG (that one is
 * task-level, keyed by taskType, with no notion of "one attempt spanning a
 * whole exam").
 *
 * Speaking is excluded entirely — not part of this feature yet.
 *
 * Per-part minutes are each part's own standalone timer, not a slice of the
 * real paper's combined budget (Reading & Use of English is 75 minutes
 * combined on the real exam; a real student self-paces across all 7 parts).
 * Giving each part its own realistic timer here means the sum can exceed 75
 * minutes — an intentional, documented approximation, same spirit as
 * PRACTICE_EXAM_CATALOG's own defaultDurationMinutes comments.
 */

export interface MockAttemptSectionCatalogEntry {
  sectionCode: string;
  contentType: MockAttemptSectionContentType;
  examCode: string;
  paperCode: string;
  partCode: string;
  /** Only for contentType 'practice_exercise' — matches GENERATABLE_PARTS' key. */
  taskType?: string;
  /** Only for contentType 'writing_task' — a fixed type (Part 1) or a pool to pick randomly from (Part 2). */
  writingTaskTypes?: readonly WritingTaskType[];
  /** Which MockTest/MockSectionScore aggregate this section's score rolls up into. */
  scoreGroup: 'reading' | 'useOfEnglish' | 'writing' | 'listening';
  defaultDurationMinutes: number;
}

export const MOCK_ATTEMPT_SECTION_CATALOG: readonly MockAttemptSectionCatalogEntry[] = [
  {
    sectionCode: 'uoe-part-1',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    taskType: 'multiple_choice_cloze',
    scoreGroup: 'useOfEnglish',
    defaultDurationMinutes: 15,
  },
  {
    sectionCode: 'uoe-part-2',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_2',
    taskType: 'open_cloze',
    scoreGroup: 'useOfEnglish',
    defaultDurationMinutes: 15,
  },
  {
    sectionCode: 'uoe-part-3',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    taskType: 'word_formation',
    scoreGroup: 'useOfEnglish',
    defaultDurationMinutes: 15,
  },
  {
    sectionCode: 'uoe-part-4',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_4',
    taskType: 'key_word_transformation',
    scoreGroup: 'useOfEnglish',
    defaultDurationMinutes: 20,
  },
  {
    sectionCode: 'reading-part-5',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'READING_PART_5',
    taskType: 'multiple_choice',
    scoreGroup: 'reading',
    defaultDurationMinutes: 12,
  },
  {
    sectionCode: 'reading-part-6',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'READING_PART_6',
    taskType: 'gapped_text',
    scoreGroup: 'reading',
    defaultDurationMinutes: 12,
  },
  {
    sectionCode: 'reading-part-7',
    contentType: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'READING_PART_7',
    taskType: 'multiple_matching',
    scoreGroup: 'reading',
    defaultDurationMinutes: 15,
  },
  {
    sectionCode: 'writing-part-1',
    contentType: MockAttemptSectionContentType.WRITING_TASK,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_2',
    partCode: 'WRITING_PART_1',
    writingTaskTypes: [WritingTaskType.ESSAY],
    scoreGroup: 'writing',
    defaultDurationMinutes: 40,
  },
  {
    sectionCode: 'writing-part-2',
    contentType: MockAttemptSectionContentType.WRITING_TASK,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_2',
    partCode: 'WRITING_PART_2',
    writingTaskTypes: [
      WritingTaskType.ARTICLE,
      WritingTaskType.EMAIL,
      WritingTaskType.REPORT,
      WritingTaskType.REVIEW,
    ],
    scoreGroup: 'writing',
    defaultDurationMinutes: 40,
  },
  {
    sectionCode: 'listening-part-1',
    contentType: MockAttemptSectionContentType.LISTENING,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_3',
    partCode: 'LISTENING_PART_1',
    scoreGroup: 'listening',
    defaultDurationMinutes: 10,
  },
  {
    sectionCode: 'listening-part-2',
    contentType: MockAttemptSectionContentType.LISTENING,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_3',
    partCode: 'LISTENING_PART_2',
    scoreGroup: 'listening',
    defaultDurationMinutes: 12,
  },
  {
    sectionCode: 'listening-part-3',
    contentType: MockAttemptSectionContentType.LISTENING,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_3',
    partCode: 'LISTENING_PART_3',
    scoreGroup: 'listening',
    defaultDurationMinutes: 10,
  },
  {
    sectionCode: 'listening-part-4',
    contentType: MockAttemptSectionContentType.LISTENING,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_3',
    partCode: 'LISTENING_PART_4',
    scoreGroup: 'listening',
    defaultDurationMinutes: 12,
  },
] as const;

export function getMockAttemptSectionCatalog(): readonly MockAttemptSectionCatalogEntry[] {
  return MOCK_ATTEMPT_SECTION_CATALOG;
}

export function findMockAttemptSectionCatalogEntry(
  sectionCode: string,
): MockAttemptSectionCatalogEntry | undefined {
  return MOCK_ATTEMPT_SECTION_CATALOG.find((entry) => entry.sectionCode === sectionCode);
}
