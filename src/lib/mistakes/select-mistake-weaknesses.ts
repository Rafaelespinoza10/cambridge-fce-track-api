import type { MistakeErrorType, MistakeErrorSubtype } from '@models/enums';
import { MISTAKE_PRACTICE_ELIGIBLE_TASK_TYPES } from '@lib/practice/generate-practice-exercise-core';

/**
 * Deterministic weakness selection + slot planning for Practice My Mistakes
 * (v1 — no mastery score, see docs/mistake-bank.md §6). Pure, DB-free: the
 * caller (GenerateMistakePracticeExerciseService) is responsible for loading
 * candidates (ownership-checked) and for turning a MistakeSlotPlan into an
 * actual LLM prompt + persisted PracticeItem.metadata.
 */

export interface WeaknessCandidate {
  id: string;
  taskType: string | null;
  baseWord: string | null;
  correctAnswer: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  timesWrong: number;
  lastWrongAt: Date;
  /**
   * Mastery of the PATTERN this concept belongs to (0-100), when the caller
   * resolved it — "practice my weaknesses" does, "practice this mistake"
   * does not, since the user already chose. Undefined means "not scored",
   * never "mastered": the sort falls back to the previous rule instead of
   * assuming anything.
   */
  masteryScore?: number;
}

export type MistakePracticeMode = 'concept_specific' | 'pattern_transfer';

export interface MistakeSlotPlanEntry {
  /** 1-based, matches the position the generated item must be assigned to. */
  position: number;
  practiceMode: MistakePracticeMode;
  targetConceptId: string;
  targetErrorType: MistakeErrorType;
  targetErrorSubtype: MistakeErrorSubtype | null;
  baseWord: string | null;
  correctAnswer: string;
}

export interface MistakeSlotPlan {
  taskType: string;
  /** Concept-specific range is always [1, conceptSpecificCount]; pattern-transfer fills the rest. */
  conceptSpecificCount: number;
  patternTransferCount: number;
  /** Every concept a slot actually targets — for exercise-level generationMetadata. */
  usedConceptIds: string[];
  entries: MistakeSlotPlanEntry[];
}

export enum SelectMistakeWeaknessesErrorCode {
  NO_ELIGIBLE_MISTAKES = 'no_eligible_mistakes',
}

export class SelectMistakeWeaknessesError extends Error {
  constructor(
    message: string,
    readonly code: SelectMistakeWeaknessesErrorCode,
  ) {
    super(message);
    this.name = 'SelectMistakeWeaknessesError';
  }
}

/** How many distinct concepts a single generated session ever targets, regardless of questionCount. */
export const MAX_SELECTION_POOL = 6;
/** Cap on how many selected concepts may share the same (errorType, errorSubtype) — keeps a "weaknesses" session from being 6 near-duplicates of the single worst concept. */
const DIVERSITY_BUCKET_CAP = 2;
const CONCEPT_SPECIFIC_RATIO = 0.25;

function bucketKey(candidate: WeaknessCandidate): string {
  return `${candidate.errorType}|${candidate.errorSubtype ?? 'none'}`;
}

/**
 * Least-mastered first when the caller scored the candidates, most-failed
 * and most-recent as tie-breaks.
 *
 * Mastery leads because "failed 9 times but 8 of those were before three
 * solid remediation sessions across four word families" is a weaker signal
 * of current weakness than "failed twice and never practised" — raw
 * `timesWrong` cannot tell those apart. When no score is available the order
 * is exactly what it was before mastery existed.
 */
function sortByPriority(candidates: WeaknessCandidate[]): WeaknessCandidate[] {
  return [...candidates].sort((a, b) => {
    if (
      a.masteryScore !== undefined &&
      b.masteryScore !== undefined &&
      a.masteryScore !== b.masteryScore
    ) {
      return a.masteryScore - b.masteryScore;
    }
    if (b.timesWrong !== a.timesWrong) return b.timesWrong - a.timesWrong;
    return b.lastWrongAt.getTime() - a.lastWrongAt.getTime();
  });
}

/**
 * One exercise = one taskType (see PracticeItem.task_type — every item of a
 * generated exercise shares it), so a mixed-taskType set of weaknesses must
 * collapse to a single one before anything else happens. Picks the taskType
 * with the highest combined `timesWrong` among the caller's own eligible
 * candidates (LEXICAL, generatable task types only — reading/matching
 * mistakes have no reusable "concept" to target); ties break on the most
 * recent failure. Throws when nothing in `candidates` is eligible at all.
 */
export function pickDominantTaskType(candidates: WeaknessCandidate[]): string {
  const eligible = candidates.filter(
    (c): c is WeaknessCandidate & { taskType: string } =>
      c.taskType !== null && MISTAKE_PRACTICE_ELIGIBLE_TASK_TYPES.has(c.taskType),
  );
  if (eligible.length === 0) {
    throw new SelectMistakeWeaknessesError(
      'None of the given mistakes belong to a task type Practice My Mistakes can generate for',
      SelectMistakeWeaknessesErrorCode.NO_ELIGIBLE_MISTAKES,
    );
  }

  const scoreByTaskType = new Map<string, { score: number; mostRecentMs: number }>();
  for (const candidate of eligible) {
    const current = scoreByTaskType.get(candidate.taskType) ?? { score: 0, mostRecentMs: 0 };
    current.score += candidate.timesWrong;
    current.mostRecentMs = Math.max(current.mostRecentMs, candidate.lastWrongAt.getTime());
    scoreByTaskType.set(candidate.taskType, current);
  }

  let bestTaskType = '';
  let best = { score: -1, mostRecentMs: -1 };
  for (const [taskType, score] of scoreByTaskType) {
    if (
      score.score > best.score ||
      (score.score === best.score && score.mostRecentMs > best.mostRecentMs)
    ) {
      bestTaskType = taskType;
      best = score;
    }
  }
  return bestTaskType;
}

/**
 * "Practice my weaknesses" selection: priority order (most-failed, most-
 * recent), capped so no more than DIVERSITY_BUCKET_CAP share the same
 * (errorType, errorSubtype) — the highest-priority mistake always wins a
 * slot, but a session never turns into 6 near-identical items. Assumes
 * `candidates` is already filtered to a single taskType.
 */
export function selectDiverseWeaknesses(
  candidates: WeaknessCandidate[],
  poolSize: number = MAX_SELECTION_POOL,
): WeaknessCandidate[] {
  const bucketCounts = new Map<string, number>();
  const selected: WeaknessCandidate[] = [];
  for (const candidate of sortByPriority(candidates)) {
    if (selected.length >= poolSize) break;
    const key = bucketKey(candidate);
    const count = bucketCounts.get(key) ?? 0;
    if (count >= DIVERSITY_BUCKET_CAP) continue;
    bucketCounts.set(key, count + 1);
    selected.push(candidate);
  }
  return selected;
}

/**
 * "Practice this mistake" selection: the user already chose which concepts
 * to target, so there is no diversity cap to apply — only a defensive
 * truncation (priority order) in case the caller ever submits more ids than
 * a session can sensibly use.
 */
export function capExplicitSelection(
  candidates: WeaknessCandidate[],
  poolSize: number = MAX_SELECTION_POOL,
): WeaknessCandidate[] {
  return sortByPriority(candidates).slice(0, poolSize);
}

function dedupeBySubtype(candidates: WeaknessCandidate[]): WeaknessCandidate[] {
  const seen = new Set<MistakeErrorSubtype>();
  const result: WeaknessCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.errorSubtype === null || seen.has(candidate.errorSubtype)) continue;
    seen.add(candidate.errorSubtype);
    result.push(candidate);
  }
  return result;
}

/**
 * Turns an already-selected, single-taskType list of weaknesses into a
 * position-by-position plan: the first `conceptSpecificCount` positions
 * round-robin over every selected concept (reusing its own word family is
 * fine there), the rest round-robin over DISTINCT known `errorSubtype`s
 * (never a concept whose subtype is still `null` — fabricating a pattern
 * nothing actually diagnosed is worse than skipping pattern-transfer for
 * this session). Falls back to 100% concept-specific when no selected
 * concept has a known errorSubtype yet (e.g. classification hasn't run, or
 * the dominant taskType is one MistakeClassifier doesn't cover today).
 */
export function buildSlotPlan(
  selected: WeaknessCandidate[],
  questionCount: number,
): MistakeSlotPlan {
  if (selected.length === 0) {
    throw new SelectMistakeWeaknessesError(
      'No mistakes were selected to build a practice session',
      SelectMistakeWeaknessesErrorCode.NO_ELIGIBLE_MISTAKES,
    );
  }

  const taskType = selected[0].taskType as string;
  const hasKnownSubtype = selected.some((c) => c.errorSubtype !== null);
  const conceptSpecificCount = hasKnownSubtype
    ? Math.min(questionCount, Math.max(1, Math.round(questionCount * CONCEPT_SPECIFIC_RATIO)))
    : questionCount;
  const patternTransferCount = questionCount - conceptSpecificCount;

  const entries: MistakeSlotPlanEntry[] = [];
  let position = 1;

  for (let i = 0; i < conceptSpecificCount; i++) {
    const concept = selected[i % selected.length];
    entries.push(toEntry(position++, 'concept_specific', concept));
  }

  if (patternTransferCount > 0) {
    const distinctSubtypeConcepts = dedupeBySubtype(selected);
    for (let i = 0; i < patternTransferCount; i++) {
      const concept = distinctSubtypeConcepts[i % distinctSubtypeConcepts.length];
      entries.push(toEntry(position++, 'pattern_transfer', concept));
    }
  }

  return {
    taskType,
    conceptSpecificCount,
    patternTransferCount,
    usedConceptIds: [...new Set(entries.map((entry) => entry.targetConceptId))],
    entries,
  };
}

function toEntry(
  position: number,
  practiceMode: MistakePracticeMode,
  concept: WeaknessCandidate,
): MistakeSlotPlanEntry {
  return {
    position,
    practiceMode,
    targetConceptId: concept.id,
    targetErrorType: concept.errorType,
    targetErrorSubtype: concept.errorSubtype,
    baseWord: concept.baseWord,
    correctAnswer: concept.correctAnswer,
  };
}
