import type { EntityManager } from 'typeorm';
import { ActivityScore } from '../../models/ActivityScore';
import { ScoreType } from '../../models/enums';

interface CreateAiLinkedActivityScoreInput {
  userId: string;
  /** The planned_activities row created by createAiLinkedPlannedActivity — supplies the title every Progress metric displays. */
  plannedActivityId: string;
  skillId: string | null;
  examSectionId: string | null;
  /** 0-100. Must not be null: the exam-parts metric filters on `sc.percentage IS NOT NULL`. */
  percentage: number;
  correctAnswers: number;
  totalQuestions: number;
  /** Feeds Progress "study minutes" via COALESCE(sc.time_spent_minutes, 0) — pass null only if genuinely untimed. */
  timeSpentMinutes: number | null;
  attemptedAt: Date;
}

/**
 * Writes the activity_scores row that makes an AI-generated, auto-graded
 * session visible to the Progress metrics, and is meant to be called right
 * after createAiLinkedPlannedActivity inside the same submit transaction.
 *
 * WHY THIS EXISTS: creating a planned_activities row is enough for Home's
 * week view and the "weekly activities" counter (both read
 * planned_activities directly), but every score-based metric reads
 * UNIFIED_SCORES_CTE in progress.repository.ts, which UNIONs exactly three
 * sources — activity_scores, practice_attempts and writing_submissions.
 * A completed activity with no score row attached is therefore invisible to
 * study minutes, weekly average, strongest/weakest skill, the study streak,
 * monthly progress by skill, recent activities and score evolution. It is
 * also invisible to GET /metrics/exam-parts, whose activity branch joins
 * activity_scores -> planned_activities (score-first), so the correct
 * exam_section_id on the activity alone buys nothing.
 *
 * DO NOT call this for Practice or Writing. They already contribute their own
 * UNION branches (practice_attempts / writing_submissions), so adding a score
 * row for them would double-count every attempt in every metric above. That
 * asymmetry is also why this is a separate helper instead of being folded into
 * createAiLinkedPlannedActivity, which all three domains share.
 */
async function createAiLinkedActivityScore(
  manager: EntityManager,
  input: CreateAiLinkedActivityScoreInput,
): Promise<ActivityScore> {
  const scoreRepo = manager.getRepository(ActivityScore);

  const entity = scoreRepo.create({
    user_id: input.userId,
    planned_activity_id: input.plannedActivityId,
    skill_id: input.skillId,
    exam_section_id: input.examSectionId,
    score_type: ScoreType.PERCENTAGE,
    raw_score: String(input.correctAnswers),
    max_score: String(input.totalQuestions),
    percentage: String(input.percentage),
    correct_answers: input.correctAnswers,
    total_questions: input.totalQuestions,
    time_spent_minutes: input.timeSpentMinutes,
    difficulty: null,
    notes: null,
    attempted_at: input.attemptedAt,
  });

  return scoreRepo.save(entity);
}

export { createAiLinkedActivityScore };
export type { CreateAiLinkedActivityScoreInput };
