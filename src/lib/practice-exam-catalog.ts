import { TargetExam } from '../models/enums';

/**
 * Pure, in-memory catalog of Practice exam/paper/part/task-type codes. No DB
 * lookups, no network calls — `examCode`/`paperCode`/`partCode`/`taskType`
 * are plain strings on the entities (see PracticeExercise/PracticeItem), not
 * Postgres enums, precisely so a new exam or part never needs a migration.
 * This module is the only place that validates those strings.
 */

export interface PracticeTaskTypeCatalogEntry {
  code: string;
  label: string;
}

export interface PracticePartCatalogEntry {
  code: string;
  label: string;
  taskTypes: readonly PracticeTaskTypeCatalogEntry[];
  /**
   * Real item count for this part in the official exam, when known — used
   * by the generation service to size the request instead of trusting the
   * caller. Undefined for parts nobody has generation support for yet.
   */
  defaultItemCount?: number;
  /** Real default duration for this part in the official exam, when known. */
  defaultDurationMinutes?: number;
  /**
   * True only for the parts GeneratePracticeExerciseService actually has a
   * prompt/schema for. A part being registered in this catalog (real,
   * verified Cambridge structure) is independent from it being generatable
   * today — most parts are catalogued but not yet generatable. Defaults to
   * false/absent everywhere except the 4 Use of English parts.
   */
  generationSupported?: boolean;
}

export interface PracticePaperCatalogEntry {
  code: string;
  label: string;
  parts: readonly PracticePartCatalogEntry[];
}

export interface PracticeExamCatalogEntry {
  code: string;
  label: string;
  papers: readonly PracticePaperCatalogEntry[];
}

function deepFreeze<T>(value: T): T {
  Object.getOwnPropertyNames(value).forEach((key) => {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && (typeof child === 'object' || typeof child === 'function')) {
      deepFreeze(child);
    }
  });
  return Object.freeze(value);
}

/**
 * `B2_FIRST` reuses `TargetExam.B2_FIRST` (already used for
 * `UserProfile.target_exam` and `MockTest.exam_type`) so this catalog never
 * drifts from the exam code the rest of the app already uses.
 *
 * `B1_PRELIMINARY` has no existing equivalent anywhere in this repository —
 * it's new, scoped only to this catalog, and does NOT touch the
 * `TargetExam`/`ExamType` Postgres enums (those back an unrelated feature:
 * the user's own study-goal exam). It still has no verified papers/parts, so
 * `papers` stays empty until a verified source exists.
 *
 * B2 First's papers/parts are NOT invented from memory — every code and
 * label here is derived mechanically from `src/config/seed/data/
 * exam-sections.ts` (already verified, already seeded into `exam_sections`
 * for the Activities module), grouped into the 4 official Cambridge papers.
 * `defaultItemCount`/`defaultDurationMinutes` are set only for the 4 Use of
 * English parts the generation service actually supports (see
 * generate-practice-exercise.service.ts) — they mirror that seed's
 * `maxScore` (1 mark/item for parts 1-3, 2 marks/item for part 4) and
 * `defaultDurationMinutes` fields exactly. The catalog registering a part does NOT
 * mean it's AI-generatable yet — Reading 6-7 (shared-passage matching),
 * Writing (essay grading), Listening (audio) and Speaking (audio/human)
 * have no generation support in this PR; that gap is intentional, not a bug.
 */
export const PRACTICE_EXAM_CATALOG: readonly PracticeExamCatalogEntry[] = deepFreeze([
  {
    code: TargetExam.B2_FIRST,
    label: 'B2 First (FCE)',
    papers: [
      {
        code: 'PAPER_1',
        label: 'Paper 1 - Reading and Use of English',
        parts: [
          {
            code: 'UOE_PART_1',
            label: 'Part 1 - Multiple Choice Cloze',
            taskTypes: [{ code: 'multiple_choice_cloze', label: 'Multiple Choice Cloze' }],
            defaultItemCount: 8,
            defaultDurationMinutes: 15,
            generationSupported: true,
          },
          {
            code: 'UOE_PART_2',
            label: 'Part 2 - Open Cloze',
            taskTypes: [{ code: 'open_cloze', label: 'Open Cloze' }],
            defaultItemCount: 8,
            defaultDurationMinutes: 15,
            generationSupported: true,
          },
          {
            code: 'UOE_PART_3',
            label: 'Part 3 - Word Formation',
            taskTypes: [{ code: 'word_formation', label: 'Word Formation' }],
            defaultItemCount: 8,
            defaultDurationMinutes: 15,
            generationSupported: true,
          },
          {
            code: 'UOE_PART_4',
            label: 'Part 4 - Key Word Transformation',
            taskTypes: [{ code: 'key_word_transformation', label: 'Key Word Transformation' }],
            defaultItemCount: 6,
            defaultDurationMinutes: 20,
            generationSupported: true,
          },
          {
            code: 'READING_PART_5',
            label: 'Part 5 - Multiple Choice',
            taskTypes: [{ code: 'multiple_choice', label: 'Multiple Choice' }],
          },
          {
            code: 'READING_PART_6',
            label: 'Part 6 - Gapped Text',
            taskTypes: [{ code: 'gapped_text', label: 'Gapped Text' }],
          },
          {
            code: 'READING_PART_7',
            label: 'Part 7 - Multiple Matching',
            taskTypes: [{ code: 'multiple_matching', label: 'Multiple Matching' }],
          },
        ],
      },
      {
        code: 'PAPER_2',
        label: 'Paper 2 - Writing',
        parts: [
          {
            code: 'WRITING_PART_1',
            label: 'Part 1 - Essay',
            taskTypes: [{ code: 'essay', label: 'Essay' }],
          },
          {
            code: 'WRITING_PART_2',
            label: 'Part 2 - Situational Writing',
            taskTypes: [{ code: 'situational_writing', label: 'Situational Writing' }],
          },
        ],
      },
      {
        code: 'PAPER_3',
        label: 'Paper 3 - Listening',
        parts: [
          {
            code: 'LISTENING_PART_1',
            label: 'Part 1 - Multiple Choice',
            taskTypes: [{ code: 'multiple_choice', label: 'Multiple Choice' }],
          },
          {
            code: 'LISTENING_PART_2',
            label: 'Part 2 - Sentence Completion',
            taskTypes: [{ code: 'sentence_completion', label: 'Sentence Completion' }],
          },
          {
            code: 'LISTENING_PART_3',
            label: 'Part 3 - Multiple Matching',
            taskTypes: [{ code: 'multiple_matching', label: 'Multiple Matching' }],
          },
          {
            code: 'LISTENING_PART_4',
            label: 'Part 4 - Multiple Choice Interview',
            taskTypes: [{ code: 'multiple_choice_interview', label: 'Multiple Choice Interview' }],
          },
        ],
      },
      {
        code: 'PAPER_4',
        label: 'Paper 4 - Speaking',
        parts: [
          {
            code: 'SPEAKING_PART_1',
            label: 'Part 1 - Interview',
            taskTypes: [{ code: 'interview', label: 'Interview' }],
          },
          {
            code: 'SPEAKING_PART_2',
            label: 'Part 2 - Long Turn',
            taskTypes: [{ code: 'long_turn', label: 'Long Turn' }],
          },
          {
            code: 'SPEAKING_PART_3',
            label: 'Part 3 - Collaborative Task',
            taskTypes: [{ code: 'collaborative_task', label: 'Collaborative Task' }],
          },
          {
            code: 'SPEAKING_PART_4',
            label: 'Part 4 - Discussion',
            taskTypes: [{ code: 'discussion', label: 'Discussion' }],
          },
        ],
      },
    ],
  },
  { code: 'B1_PRELIMINARY', label: 'B1 Preliminary (PET)', papers: [] },
]);

// ── Generic catalog engine — operates on any catalog array, not just the
// production one above. Kept separate so tests can exercise real valid/
// invalid paper/part/task-type cases against a small fixture catalog without
// fabricating unverified Cambridge content in the production catalog. ──────

export function findExamInCatalog(
  catalog: readonly PracticeExamCatalogEntry[],
  examCode: string,
): PracticeExamCatalogEntry | undefined {
  return catalog.find((exam) => exam.code === examCode);
}

export function findPaperInCatalog(
  catalog: readonly PracticeExamCatalogEntry[],
  examCode: string,
  paperCode: string,
): PracticePaperCatalogEntry | undefined {
  return findExamInCatalog(catalog, examCode)?.papers.find((paper) => paper.code === paperCode);
}

export function findPartInCatalog(
  catalog: readonly PracticeExamCatalogEntry[],
  examCode: string,
  paperCode: string,
  partCode: string,
): PracticePartCatalogEntry | undefined {
  return findPaperInCatalog(catalog, examCode, paperCode)?.parts.find(
    (part) => part.code === partCode,
  );
}

export function findTaskTypeInCatalog(
  catalog: readonly PracticeExamCatalogEntry[],
  examCode: string,
  paperCode: string,
  partCode: string,
  taskType: string,
): PracticeTaskTypeCatalogEntry | undefined {
  return findPartInCatalog(catalog, examCode, paperCode, partCode)?.taskTypes.find(
    (entry) => entry.code === taskType,
  );
}

// ── Production catalog convenience wrappers ────────────────────────────────

export function isPracticeExamCode(examCode: string): boolean {
  return findExamInCatalog(PRACTICE_EXAM_CATALOG, examCode) !== undefined;
}

export function isPracticePaperCode(examCode: string, paperCode: string): boolean {
  return findPaperInCatalog(PRACTICE_EXAM_CATALOG, examCode, paperCode) !== undefined;
}

export function isPracticePartCode(examCode: string, paperCode: string, partCode: string): boolean {
  return findPartInCatalog(PRACTICE_EXAM_CATALOG, examCode, paperCode, partCode) !== undefined;
}

export function isPracticeTaskType(
  examCode: string,
  paperCode: string,
  partCode: string,
  taskType: string,
): boolean {
  return (
    findTaskTypeInCatalog(PRACTICE_EXAM_CATALOG, examCode, paperCode, partCode, taskType) !==
    undefined
  );
}

/**
 * Whether GeneratePracticeExerciseService has a prompt/schema for this part
 * — independent from whether the part exists in the catalog (most parts do,
 * few are generatable). False for an unknown exam/paper/part too.
 */
export function isPracticeGenerationSupported(
  examCode: string,
  paperCode: string,
  partCode: string,
): boolean {
  return (
    findPartInCatalog(PRACTICE_EXAM_CATALOG, examCode, paperCode, partCode)?.generationSupported ===
    true
  );
}
