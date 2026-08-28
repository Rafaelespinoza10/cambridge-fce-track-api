import { buildPatternKey } from '@lib/mistakes/mistake-pattern';
import { computeMastery, MASTERY_CONSTANTS } from '@lib/mistakes/mastery-score';
import type { RemediationDay } from '@lib/mistakes/mastery-score';
import type {
  PatternFailureRow,
  PatternRemediationDayRow,
  WeaknessQueryFilters,
} from '@repositories/mistakes/mistake-mastery.repository';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';

const MS_PER_DAY = 86_400_000;

export interface MistakeMasteryRepositoryPort {
  findPatternFailures(
    userId: string,
    recentWindowStart: Date,
    filters: WeaknessQueryFilters,
  ): Promise<PatternFailureRow[]>;
  findRemediationDays(userId: string, timeZone: string): Promise<PatternRemediationDayRow[]>;
}

export interface WeaknessProfileDeps {
  repository: MistakeMasteryRepositoryPort;
  /** The user's IANA zone — remediation days are the user's own calendar days, not UTC's. */
  resolveTimeZone: (userId: string) => Promise<string>;
  /** Injectable clock: every decay and penalty in the score is relative to it. */
  now?: () => Date;
}

/**
 * The one place weakness patterns are built and scored, shared by the
 * Weaknesses endpoint (ListWeaknessesService) and by Practice My Mistakes'
 * "practice my weaknesses" selection — so the list a user sees and the order
 * the generator practises them in can never disagree.
 *
 * Both repository reads are scoped to `userId`; there is no path here that
 * can mix two users' evidence.
 */
export async function computeWeaknessProfiles(
  deps: WeaknessProfileDeps,
  userId: string,
  filters: WeaknessQueryFilters = {},
): Promise<WeaknessDto[]> {
  const now = (deps.now ?? (() => new Date()))();
  const recentWindowStart = new Date(
    now.getTime() - MASTERY_CONSTANTS.MASTERED_NO_FAILURE_WINDOW_DAYS * MS_PER_DAY,
  );

  const timeZone = await deps.resolveTimeZone(userId);
  const [failures, remediationDays] = await Promise.all([
    deps.repository.findPatternFailures(userId, recentWindowStart, filters),
    deps.repository.findRemediationDays(userId, timeZone),
  ]);

  const remediationByPattern = groupRemediationByPattern(remediationDays);

  return failures.map((failure) => toDto(failure, remediationByPattern, now)).sort(weakestFirst);
}

function toDto(
  failure: PatternFailureRow,
  remediationByPattern: Map<string, RemediationDay[]>,
  now: Date,
): WeaknessDto {
  const key = buildPatternKey({
    partCode: failure.partCode,
    errorType: failure.errorType,
    errorSubtype: failure.errorSubtype,
  });
  const mastery = computeMastery(
    {
      timesWrong: failure.timesWrong,
      lastWrongAt: failure.lastWrongAt,
      wrongsInRecentWindow: failure.wrongsInRecentWindow,
      remediationDays: remediationByPattern.get(key) ?? [],
    },
    now,
  );

  return {
    skill: failure.skill,
    examCode: failure.examCode,
    paperCode: failure.paperCode,
    partCode: failure.partCode,
    errorType: failure.errorType,
    errorSubtype: failure.errorSubtype,
    masteryScore: mastery.score,
    status: mastery.status,
    timesWrong: failure.timesWrong,
    conceptCount: failure.conceptCount,
    remediationAttempts: mastery.remediationAttempts,
    remediationCorrect: mastery.remediationCorrect,
    distinctBaseWords: mastery.distinctBaseWords,
    distinctPracticeDays: mastery.distinctPracticeDays,
    firstSeenAt: failure.firstSeenAt,
    lastWrongAt: failure.lastWrongAt,
    lastPracticedAt: mastery.lastPracticedAt,
    masteredBlocked: mastery.masteredBlocked,
  };
}

/**
 * Remediation rows are keyed by the pattern the generator targeted, not by
 * the concept — that is what lets ten different word families practised
 * under `adjective_to_adverb` feed one pattern, while a different subtype
 * stays in its own bucket.
 */
function groupRemediationByPattern(
  rows: PatternRemediationDayRow[],
): Map<string, RemediationDay[]> {
  const byPattern = new Map<string, RemediationDay[]>();
  for (const row of rows) {
    const key = buildPatternKey({
      partCode: row.partCode,
      errorType: row.errorType,
      errorSubtype: row.errorSubtype,
    });
    const days = byPattern.get(key) ?? [];
    days.push({
      day: row.day,
      attempts: row.attempts,
      correct: row.correct,
      familiesCorrect: row.families,
    });
    byPattern.set(key, days);
  }
  return byPattern;
}

/** Weakest first: lowest mastery, then most-failed, then a stable key so the order never flickers. */
export function weakestFirst(a: WeaknessDto, b: WeaknessDto): number {
  if (a.masteryScore !== b.masteryScore) return a.masteryScore - b.masteryScore;
  if (a.timesWrong !== b.timesWrong) return b.timesWrong - a.timesWrong;
  return buildPatternKey(a).localeCompare(buildPatternKey(b));
}

/**
 * Pattern key -> mastery score, for callers that only need to rank something
 * by weakness (see the "practice my weaknesses" selection).
 */
export function toMasteryScoreByPattern(profiles: WeaknessDto[]): Map<string, number> {
  return new Map(profiles.map((profile) => [buildPatternKey(profile), profile.masteryScore]));
}
