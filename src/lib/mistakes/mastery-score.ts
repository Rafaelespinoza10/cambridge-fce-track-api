/**
 * Mastery / weakness scoring for the Mistake Bank — pure, deterministic, no
 * DB and no AI. This is the ONLY place the formula lives; the repository
 * aggregates evidence (per pattern, per local day) and this module turns it
 * into a 0-100 score and a status.
 *
 * The whole design answers three questions about a weakness pattern (e.g.
 * ADJECTIVE_TO_ADVERB), not about a single word:
 *
 *   Is this still a weakness?  Is it improving?  Can it be called mastered?
 *
 * It deliberately never reads MistakeConcept.times_correct: that counter
 * moves whenever the same concept_key is answered right again, which says
 * nothing about whether the *pattern* transfers to other words. Mastery is
 * built from remediation evidence (Practice My Mistakes answers, tagged with
 * the pattern they target) plus the failure history.
 */

/** Every tunable number of the formula, in one place — adjust without touching logic. */
export const MASTERY_CONSTANTS = {
  /** A remediation answer keeps half its weight after this many days. */
  ANSWER_HALF_LIFE_DAYS: 30,
  /** Time-weighted attempts needed for full confidence in the observed accuracy. */
  VOLUME_TARGET_ATTEMPTS: 8,
  /** Distinct lexical families needed for full transfer credit. */
  FAMILY_TARGET: 3,
  /** Distinct practice days needed for full repetition credit. */
  DAY_TARGET: 3,

  /** Trust floor: with no volume/family/day evidence at all, only 45% of the observed accuracy is credited. */
  TRUST_BASE: 0.45,
  TRUST_VOLUME_WEIGHT: 0.15,
  TRUST_FAMILY_WEIGHT: 0.2,
  TRUST_DAY_WEIGHT: 0.2,

  /** Knowledge not exercised in a long time loses confidence, but never all of it. */
  STALENESS_HALF_LIFE_DAYS: 90,
  STALENESS_FLOOR: 0.6,

  /** A failure today costs the full penalty; it halves every two weeks. */
  FAILURE_PENALTY_MAX: 15,
  FAILURE_HALF_LIFE_DAYS: 14,

  /** Status bands (inclusive lower bounds). */
  LEARNING_MIN_SCORE: 40,
  STRONG_MIN_SCORE: 70,
  MASTERED_MIN_SCORE: 85,

  /** MASTERED gates. */
  MASTERED_MIN_FAMILIES: 3,
  MASTERED_MIN_DAYS: 3,
  MASTERED_NO_FAILURE_WINDOW_DAYS: 30,
  /** A pattern that fails a gate is capped just below the mastered band, so score and status never disagree. */
  MASTERED_BLOCKED_MAX_SCORE: 84,
} as const;

export enum MasteryStatus {
  WEAK = 'weak',
  LEARNING = 'learning',
  STRONG = 'strong',
  MASTERED = 'mastered',
}

/**
 * Remediation answers for one pattern on one of the user's local calendar
 * days. The repository groups them this way (instead of returning every
 * answer row) so the aggregation stays in Postgres while the formula stays
 * here: a 30-day half-life doesn't care about sub-day precision.
 */
export interface RemediationDay {
  /** The user's own local day, 'YYYY-MM-DD'. */
  day: string;
  attempts: number;
  correct: number;
  /** Distinct lexical families answered correctly that day (may repeat across days). */
  familiesCorrect: string[];
}

export interface PatternEvidence {
  /** Total recorded failures of this pattern, all time. */
  timesWrong: number;
  lastWrongAt: Date | null;
  /** Failures inside MASTERED_NO_FAILURE_WINDOW_DAYS — a relapse gate, not a score term. */
  wrongsInRecentWindow: number;
  remediationDays: RemediationDay[];
}

export interface MasteryBreakdown {
  score: number;
  status: MasteryStatus;
  remediationAttempts: number;
  remediationCorrect: number;
  distinctBaseWords: number;
  distinctPracticeDays: number;
  lastPracticedAt: Date | null;
  /** True when the score was capped because a MASTERED gate failed — useful for explaining the number. */
  masteredBlocked: boolean;
}

const MS_PER_DAY = 86_400_000;

function ageInDays(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Half-life decay: 1 at age 0, 0.5 at one half-life, never negative. */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Noon of the given local day, as an instant. Remediation evidence is
 * bucketed per local day, so its exact clock time is unknown; noon keeps a
 * day's age within ±12h of the truth, which a 30-day half-life cannot
 * meaningfully feel, and never makes today's evidence look like tomorrow's.
 */
function dayInstant(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

/**
 * The formula, in the order the plan describes it:
 *
 *   score = clamp(100 × accuracyW × trust × staleness − failurePenalty, 0, 100)
 *
 * Rewards, in `trust`: volume of recent practice, distinct lexical families
 * (transfer), distinct practice days (repetition). Punishes: recent
 * failures (`failurePenalty`), old-only evidence (`staleness`) and, through
 * `accuracyW`'s half-life, answers that are right long ago but wrong lately.
 *
 * With no remediation evidence at all the score is 0: the pattern was
 * failed and never worked on, which is the definition of a live weakness.
 */
export function computeMastery(evidence: PatternEvidence, now: Date): MasteryBreakdown {
  const c = MASTERY_CONSTANTS;

  const remediationAttempts = evidence.remediationDays.reduce((sum, d) => sum + d.attempts, 0);
  const remediationCorrect = evidence.remediationDays.reduce((sum, d) => sum + d.correct, 0);

  const families = new Set<string>();
  for (const day of evidence.remediationDays) {
    for (const family of day.familiesCorrect) families.add(family);
  }
  const distinctBaseWords = families.size;
  const distinctPracticeDays = evidence.remediationDays.filter((d) => d.correct > 0).length;

  const lastPracticedAt =
    evidence.remediationDays.length === 0
      ? null
      : dayInstant(
          evidence.remediationDays.reduce((latest, d) => (d.day > latest ? d.day : latest), ''),
        );

  const base: Omit<MasteryBreakdown, 'score' | 'status' | 'masteredBlocked'> = {
    remediationAttempts,
    remediationCorrect,
    distinctBaseWords,
    distinctPracticeDays,
    lastPracticedAt,
  };

  if (remediationAttempts === 0) {
    return { ...base, score: 0, status: MasteryStatus.WEAK, masteredBlocked: false };
  }

  let weightedAttempts = 0;
  let weightedCorrect = 0;
  for (const day of evidence.remediationDays) {
    const weight = decayWeight(ageInDays(dayInstant(day.day), now), c.ANSWER_HALF_LIFE_DAYS);
    weightedAttempts += day.attempts * weight;
    weightedCorrect += day.correct * weight;
  }
  // Unreachable while remediationAttempts > 0 (the weight is always > 0),
  // but a division by zero must never be able to produce NaN as a score.
  const accuracyW = weightedAttempts === 0 ? 0 : weightedCorrect / weightedAttempts;

  const trust =
    c.TRUST_BASE +
    c.TRUST_VOLUME_WEIGHT * Math.min(1, weightedAttempts / c.VOLUME_TARGET_ATTEMPTS) +
    c.TRUST_FAMILY_WEIGHT * Math.min(1, distinctBaseWords / c.FAMILY_TARGET) +
    c.TRUST_DAY_WEIGHT * Math.min(1, distinctPracticeDays / c.DAY_TARGET);

  const staleness =
    lastPracticedAt === null
      ? c.STALENESS_FLOOR
      : Math.max(
          c.STALENESS_FLOOR,
          decayWeight(ageInDays(lastPracticedAt, now), c.STALENESS_HALF_LIFE_DAYS),
        );

  const failurePenalty =
    evidence.lastWrongAt === null
      ? 0
      : c.FAILURE_PENALTY_MAX *
        decayWeight(ageInDays(evidence.lastWrongAt, now), c.FAILURE_HALF_LIFE_DAYS);

  const rawScore = 100 * accuracyW * trust * staleness - failurePenalty;
  let score = Math.round(clamp(rawScore, 0, 100));

  const meetsGates =
    distinctBaseWords >= c.MASTERED_MIN_FAMILIES &&
    distinctPracticeDays >= c.MASTERED_MIN_DAYS &&
    evidence.wrongsInRecentWindow === 0;

  const masteredBlocked = score >= c.MASTERED_MIN_SCORE && !meetsGates;
  if (masteredBlocked) score = c.MASTERED_BLOCKED_MAX_SCORE;

  return { ...base, score, status: toStatus(score, meetsGates), masteredBlocked };
}

/**
 * Bands are pure thresholds except MASTERED, which additionally requires
 * evidence of transfer (families), of repetition across days, and no recent
 * relapse — so three correct answers in a row on one word, on one day, can
 * never read as mastered no matter how high the arithmetic goes.
 */
export function toStatus(score: number, meetsMasteredGates: boolean): MasteryStatus {
  const c = MASTERY_CONSTANTS;
  if (score >= c.MASTERED_MIN_SCORE && meetsMasteredGates) return MasteryStatus.MASTERED;
  if (score >= c.STRONG_MIN_SCORE) return MasteryStatus.STRONG;
  if (score >= c.LEARNING_MIN_SCORE) return MasteryStatus.LEARNING;
  return MasteryStatus.WEAK;
}
