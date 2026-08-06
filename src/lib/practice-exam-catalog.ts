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
 * Only the exam codes are confirmed for this PR — `papers` is intentionally
 * empty for both exams.
 *
 * `B2_FIRST` reuses `TargetExam.B2_FIRST` (already used for
 * `UserProfile.target_exam` and `MockTest.exam_type`) so this catalog never
 * drifts from the exam code the rest of the app already uses.
 *
 * `B1_PRELIMINARY` has no existing equivalent anywhere in this repository —
 * it's new, scoped only to this catalog, and does NOT touch the
 * `TargetExam`/`ExamType` Postgres enums (those back an unrelated feature:
 * the user's own study-goal exam).
 *
 * Missing metadata, to be added once verified against an official Cambridge
 * spec (not from memory) in the exercise-generation PR:
 *   - B2 First: Paper 1 (Reading & Use of English), Paper 2 (Writing),
 *     Paper 3 (Listening), Paper 4 (Speaking) — and every part within them.
 *   - B1 Preliminary: all papers and parts.
 */
export const PRACTICE_EXAM_CATALOG: readonly PracticeExamCatalogEntry[] = deepFreeze([
  { code: TargetExam.B2_FIRST, label: 'B2 First (FCE)', papers: [] },
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
