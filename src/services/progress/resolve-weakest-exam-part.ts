import type { DataSource } from 'typeorm';
import { ProgressRepository } from '@repositories/progress/progress.repository';

/**
 * A part is only a candidate once there's enough evidence to call it weak.
 * One bad attempt is noise, and targeting it would send a learner to grind a
 * part they simply had a bad day on.
 */
const MIN_ATTEMPTS = 2;

/**
 * Above this, nothing is "weak" enough to be worth redirecting a whole
 * session to. A learner averaging 85% everywhere should keep getting varied
 * material, not be nudged at their least-perfect part.
 */
const WEAKNESS_CEILING = 80;

export interface WeakestExamPart {
  sectionSlug: string;
  sectionName: string;
  skillSlug: string;
  skillName: string;
  averageScore: number;
  completedAttempts: number;
}

/**
 * The Cambridge part a learner is currently worst at, or null when there
 * isn't enough evidence to say.
 *
 * Reads getExamPartMetrics on purpose rather than the Practice adaptive
 * module's PracticeInsights: that one is built from practice_attempts alone,
 * so a Reading part failed repeatedly in timed mocks, or Writing graded low,
 * would be invisible to it. getExamPartMetrics unions practice attempts,
 * writing submissions and mock section scores, which is the whole picture a
 * learner actually has.
 *
 * Returning null is a normal outcome, not a failure — every caller is
 * expected to fall back to its existing behaviour, so a new user with no
 * history keeps getting varied material instead of nothing.
 */
export async function resolveWeakestExamPart(
  dataSource: DataSource,
  userId: string,
): Promise<WeakestExamPart | null> {
  const repo = new ProgressRepository(dataSource);
  const rows = await repo.getExamPartMetrics(userId);

  const candidates = rows.filter(
    (row) => row.completedAttempts >= MIN_ATTEMPTS && row.averageScore < WEAKNESS_CEILING,
  );
  if (candidates.length === 0) return null;

  // Lowest average wins; ties break toward the part with more attempts, since
  // that score is the better-evidenced of the two.
  const weakest = candidates.reduce((worst, row) => {
    if (row.averageScore < worst.averageScore) return row;
    if (row.averageScore > worst.averageScore) return worst;
    return row.completedAttempts > worst.completedAttempts ? row : worst;
  });

  return {
    sectionSlug: weakest.sectionSlug,
    sectionName: weakest.sectionName,
    skillSlug: weakest.skillSlug,
    skillName: weakest.skillName,
    averageScore: weakest.averageScore,
    completedAttempts: weakest.completedAttempts,
  };
}
