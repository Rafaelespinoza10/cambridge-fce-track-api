import type { MistakeErrorType, MistakeErrorSubtype } from '@models/enums';
import { buildPatternKey } from '@lib/mistakes/mistake-pattern';

/**
 * Deterministic weakness-pattern selection + slot planning for Mistake
 * Remix. Pure, DB-free: the caller (GenerateMistakeRemixExerciseService)
 * loads the weakness profiles (GET /practice/weaknesses' own
 * computeWeaknessProfiles) and the representative concepts, and turns the
 * resulting RemixPlan into an LLM prompt + persisted PracticeItem.metadata.
 *
 * Unlike Practice My Mistakes (one dominant pattern per session), a Remix
 * session deliberately spreads across MULTIPLE patterns plus neutral control
 * items, interleaved so no single pattern — however weak — monopolizes or
 * telegraphs the session.
 */

export interface RemixWeaknessPattern {
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  /** 0-100, see @lib/mistakes/mastery-score.ts. Lower = weaker = higher selection weight. */
  masteryScore: number;
  lastWrongAt: Date;
}

export interface RemixConceptCandidate {
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  baseWord: string | null;
  correctAnswer: string;
  timesWrong: number;
}

export type RemixQuestionRole = 'targeted' | 'neutral';

export interface RemixSlotPlanEntry {
  /** 1-based, matches the position the generated item must be assigned to. */
  position: number;
  role: RemixQuestionRole;
  targetErrorType: MistakeErrorType | null;
  targetErrorSubtype: MistakeErrorSubtype | null;
  /** A representative failed word for this position's pattern, for prompt context — null for neutral. */
  exampleBaseWord: string | null;
  exampleCorrectAnswer: string | null;
}

export interface RemixTargetPattern {
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  questionCount: number;
}

export interface RemixPlan {
  targetedCount: number;
  neutralCount: number;
  /** Weakest/most-recent first — the same order the allocation walked. */
  targetPatterns: RemixTargetPattern[];
  /** Recently-failed base words behind the selected patterns — a strong preference for the prompt, never absolute. */
  avoidBaseWords: string[];
  entries: RemixSlotPlanEntry[];
}

/** How many distinct patterns a single session ever considers, regardless of questionCount. */
export const MAX_REMIX_PATTERNS = 6;
/** No pattern — however weak — may monopolize a session. */
export const MAX_QUESTIONS_PER_PATTERN = 2;
/** Of the session, the share that targets a real weakness; the rest are neutral control items. */
export const REMIX_TARGETED_RATIO = 0.625;
const MAX_AVOID_BASE_WORDS = 10;

function patternKeyOf(p: { partCode: string; errorType: string; errorSubtype: string | null }): string {
  return buildPatternKey(p);
}

/** Least-mastered first (highest `100 - masteryScore` weight), most-recent failure as tie-break. */
function sortPatternsByWeight(patterns: RemixWeaknessPattern[]): RemixWeaknessPattern[] {
  return [...patterns].sort((a, b) => {
    const weightA = 100 - a.masteryScore;
    const weightB = 100 - b.masteryScore;
    if (weightA !== weightB) return weightB - weightA;
    return b.lastWrongAt.getTime() - a.lastWrongAt.getTime();
  });
}

/** How many of `questionCount` target a real weakness — the rest are neutral. */
export function computeTargetedCount(questionCount: number): number {
  return Math.round(questionCount * REMIX_TARGETED_RATIO);
}

interface AllocatedPattern {
  pattern: RemixWeaknessPattern;
  count: number;
}

/**
 * Weighted round-robin with a per-pattern cap: walk the priority-ordered
 * pattern list repeatedly, +1 slot per pattern per pass, skipping any
 * pattern already at MAX_QUESTIONS_PER_PATTERN, until every targeted slot is
 * placed or no pattern can accept more. Slots that can't be placed (too few
 * distinct weaknesses) are simply never allocated here — the caller turns
 * the shortfall into extra neutral slots, never a fabricated pattern.
 */
function allocateTargetedSlots(
  orderedPatterns: RemixWeaknessPattern[],
  targetedCount: number,
): AllocatedPattern[] {
  const allocations = orderedPatterns.map((pattern) => ({ pattern, count: 0 }));
  let allocated = 0;

  let progressed = true;
  while (allocated < targetedCount && progressed) {
    progressed = false;
    for (const allocation of allocations) {
      if (allocated >= targetedCount) break;
      if (allocation.count >= MAX_QUESTIONS_PER_PATTERN) continue;
      allocation.count += 1;
      allocated += 1;
      progressed = true;
    }
  }

  return allocations.filter((allocation) => allocation.count > 0);
}

interface InterleaveGroup {
  key: string;
  role: RemixQuestionRole;
  remaining: number;
  pattern: RemixWeaknessPattern | null;
}

/**
 * Round-robins position-by-position across every group (each selected
 * pattern, plus one "neutral" group), skipping exhausted groups and
 * preferring not to repeat the immediately preceding position's group — so a
 * session reads like Q1 pattern-A, Q2 neutral, Q3 pattern-B, ... rather than
 * blocks. The no-repeat preference is best-effort: when only one group has
 * slots left, it is used even if that means two in a row (unavoidable, and
 * still never more than MAX_QUESTIONS_PER_PATTERN total for a pattern).
 */
function interleaveGroups(groups: InterleaveGroup[], totalCount: number): InterleaveGroup[] {
  const order: InterleaveGroup[] = [];
  let cursor = 0;

  while (order.length < totalCount) {
    let placedPreferred = false;
    for (let attempt = 0; attempt < groups.length; attempt++) {
      const idx = (cursor + attempt) % groups.length;
      const group = groups[idx];
      if (group.remaining <= 0) continue;
      if (order.length > 0 && order[order.length - 1] === group) continue;
      order.push(group);
      group.remaining -= 1;
      cursor = idx + 1;
      placedPreferred = true;
      break;
    }
    if (placedPreferred) continue;

    // Nothing eligible-and-different — every remaining slot belongs to the
    // same group as the previous position. Take it anyway rather than stall.
    const fallbackIdx = groups.findIndex((group) => group.remaining > 0);
    if (fallbackIdx === -1) break; // unreachable: sum(remaining) === totalCount
    const group = groups[fallbackIdx];
    order.push(group);
    group.remaining -= 1;
    cursor = fallbackIdx + 1;
  }

  return order;
}

/**
 * Builds a full Remix session plan from the user's own weakness profiles
 * (already scored, see computeWeaknessProfiles) and a pool of concrete
 * mistakes to draw prompt examples from. Never throws on zero weaknesses —
 * it degrades to an all-neutral plan; the caller (the generation service)
 * decides whether that's acceptable or should be rejected as
 * NO_ELIGIBLE_MISTAKES.
 */
export function buildRemixPlan(
  patterns: RemixWeaknessPattern[],
  concepts: RemixConceptCandidate[],
  questionCount: number,
): RemixPlan {
  const conceptsByPattern = new Map<string, RemixConceptCandidate[]>();
  for (const concept of concepts) {
    const key = patternKeyOf(concept);
    const list = conceptsByPattern.get(key) ?? [];
    list.push(concept);
    conceptsByPattern.set(key, list);
  }
  for (const list of conceptsByPattern.values()) {
    list.sort((a, b) => b.timesWrong - a.timesWrong);
  }

  // A pattern with no concrete concept behind it (e.g. trimmed by the
  // concept pool's own query limit) has nothing to build a prompt example
  // from — it is excluded here rather than left dangling later.
  const eligiblePatterns = sortPatternsByWeight(patterns)
    .filter((pattern) => (conceptsByPattern.get(patternKeyOf(pattern))?.length ?? 0) > 0)
    .slice(0, MAX_REMIX_PATTERNS);

  const targetedCount = computeTargetedCount(questionCount);
  const allocations = allocateTargetedSlots(eligiblePatterns, targetedCount);
  const actualTargetedCount = allocations.reduce((sum, a) => sum + a.count, 0);
  const neutralCount = questionCount - actualTargetedCount;

  const groups: InterleaveGroup[] = allocations.map((allocation) => ({
    key: patternKeyOf(allocation.pattern),
    role: 'targeted',
    remaining: allocation.count,
    pattern: allocation.pattern,
  }));
  if (neutralCount > 0) {
    groups.push({ key: 'neutral', role: 'neutral', remaining: neutralCount, pattern: null });
  }

  const conceptCursorByPattern = new Map<string, number>();
  function nextConceptFor(pattern: RemixWeaknessPattern): RemixConceptCandidate {
    const key = patternKeyOf(pattern);
    const list = conceptsByPattern.get(key) as RemixConceptCandidate[];
    const cursor = conceptCursorByPattern.get(key) ?? 0;
    conceptCursorByPattern.set(key, cursor + 1);
    return list[cursor % list.length];
  }

  const entries: RemixSlotPlanEntry[] = interleaveGroups(groups, questionCount).map(
    (group, index) => {
      if (group.role === 'neutral' || group.pattern === null) {
        return {
          position: index + 1,
          role: 'neutral',
          targetErrorType: null,
          targetErrorSubtype: null,
          exampleBaseWord: null,
          exampleCorrectAnswer: null,
        };
      }
      const concept = nextConceptFor(group.pattern);
      return {
        position: index + 1,
        role: 'targeted',
        targetErrorType: group.pattern.errorType,
        targetErrorSubtype: group.pattern.errorSubtype,
        exampleBaseWord: concept.baseWord,
        exampleCorrectAnswer: concept.correctAnswer,
      };
    },
  );

  const avoidBaseWords = [
    ...new Set(
      allocations
        .flatMap((allocation) => conceptsByPattern.get(patternKeyOf(allocation.pattern)) ?? [])
        .map((concept) => concept.baseWord)
        .filter((word): word is string => word !== null),
    ),
  ].slice(0, MAX_AVOID_BASE_WORDS);

  return {
    targetedCount: actualTargetedCount,
    neutralCount,
    targetPatterns: allocations.map((allocation) => ({
      errorType: allocation.pattern.errorType,
      errorSubtype: allocation.pattern.errorSubtype,
      questionCount: allocation.count,
    })),
    avoidBaseWords,
    entries,
  };
}
