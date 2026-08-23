import { EnglishLevel } from '@models/enums';

/**
 * Rough, clearly-labeled ESTIMATE of a B2 First result — not an official
 * Cambridge Scale Score. Cambridge computes the real one with a statistical
 * (IRT) equating model that isn't public and varies per test session, so
 * this can never be exact. What IS public is the score-range each grade/
 * level corresponds to (cambridgeenglish.org): Grade A 180-190 (reported as
 * C1), Grade B 173-179, Grade C 160-172 (the B2 pass), Level B1 140-159,
 * below 140 reported as A2. This piecewise-linear-interpolates a mock's
 * overall percentage onto those published anchors — calibrated so ~60%
 * lands near the real Grade C pass boundary, not a naive 0-100 -> 100-190
 * straight line (which would put a realistic ~60% pass in B1 territory).
 *
 * Only meaningful for B2 First — the only exam type full timed mocks
 * support today (see StartMockAttemptService).
 */

interface ScoreAnchor {
  percentage: number;
  score: number;
}

const B2_FIRST_ANCHORS: readonly ScoreAnchor[] = [
  { percentage: 0, score: 100 },
  { percentage: 45, score: 140 },
  { percentage: 60, score: 160 },
  { percentage: 75, score: 173 },
  { percentage: 90, score: 180 },
  { percentage: 100, score: 190 },
];

export interface EstimatedMockResult {
  /** Estimated Cambridge Scale Score (100-190) — an approximation, never an official score. */
  estimatedScore: number;
  estimatedLevel: EnglishLevel;
}

export function estimateCambridgeScaleScore(overallPercentage: number): number {
  const p = Math.max(0, Math.min(100, overallPercentage));
  for (let i = 0; i < B2_FIRST_ANCHORS.length - 1; i += 1) {
    const a = B2_FIRST_ANCHORS[i]!;
    const b = B2_FIRST_ANCHORS[i + 1]!;
    if (p >= a.percentage && p <= b.percentage) {
      const t = (p - a.percentage) / (b.percentage - a.percentage);
      return Math.round(a.score + t * (b.score - a.score));
    }
  }
  return B2_FIRST_ANCHORS[B2_FIRST_ANCHORS.length - 1]!.score;
}

/** Mirrors Cambridge's own real B2 First grade boundaries. */
export function estimateLevelFromScore(score: number): EnglishLevel {
  if (score >= 180) return EnglishLevel.C1;
  if (score >= 160) return EnglishLevel.B2;
  if (score >= 140) return EnglishLevel.B1;
  return EnglishLevel.A2;
}

export function estimateB2FirstResult(overallPercentage: number): EstimatedMockResult {
  const estimatedScore = estimateCambridgeScaleScore(overallPercentage);
  return { estimatedScore, estimatedLevel: estimateLevelFromScore(estimatedScore) };
}
