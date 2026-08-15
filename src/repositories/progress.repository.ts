import type { DataSource } from 'typeorm';
import { PlannedActivity } from '../models/PlannedActivity';
import { PlanDay } from '../models/PlanDay';
import { WeeklyPlan } from '../models/WeeklyPlan';
import { MockTest } from '../models/MockTest';
import { UserGoal } from '../models/UserGoal';
import { PracticeAttempt } from '../models/PracticeAttempt';
import { PracticeExercise } from '../models/PracticeExercise';
import { PracticeAttemptStatus } from '../models/enums';

interface WeeklyActivityStats {
  total: number;
  completed: number;
}

interface WeeklyScoreStats {
  avgScore: number | null;
  studyMinutes: number;
}

interface SkillAverage {
  skillName: string;
  avgScore: number;
}

interface SkillWeekRow {
  skillName: string;
  weekStart: string;
  avgScore: number;
}

interface RecentActivityRow {
  id: string;
  title: string;
  skillName: string | null;
  score: number | null;
  date: string;
}

interface OverallWeekRow {
  weekStart: string;
  avgScore: number;
}

interface PracticePartMetricRow {
  examCode: string;
  paperCode: string;
  partCode: string;
  completedAttempts: number;
  correctCount: number;
  totalCount: number;
  averageScore: number;
  lastAttemptAt: Date;
}

interface ScoreEvolutionRow {
  occurredAt: Date;
  skillSlug: string;
  skillName: string;
  percentage: number;
}

interface WritingCriterionMetricRow {
  criterion: string;
  averageBand: number;
}

interface WritingMetricsSummaryRow {
  completedCount: number;
  overallAverageBand: number | null;
  lastAttemptAt: Date | null;
}

/**
 * One row per graded score, regardless of source — a manually-logged
 * ActivityScore, a completed Practice attempt, or a graded Writing
 * submission. Built with a raw parameterized CTE (not QueryBuilder)
 * because TypeORM's QueryBuilder has no clean way to UNION three
 * structurally different tables and then GROUP BY/AVG over the result —
 * every value substituted here is a `$n` placeholder, never string-
 * interpolated, same injection discipline as the rest of this codebase.
 *
 * Deliberately does NOT filter `percentage IS NOT NULL` here — some
 * callers (getStudyDates, getRecentActivities) need every row regardless
 * of whether a percentage was ever computed (matches the original
 * ActivityScore-only behavior); callers that aggregate scores add that
 * filter themselves.
 *
 * Practice/Writing rows resolve a `skill_name` from their catalog codes
 * instead of a Skill FK (neither table has one) — Skill is seeded with
 * rows named exactly 'Use of English' and 'Writing'
 * (src/config/seed/data/skills.ts), so these land in the same bucket a
 * manually-logged activity for that skill would. The CASE for Practice is
 * intentionally not a bare hardcode: only UOE_PART_% is generatable today,
 * but this leaves room for READING_PART_% later without another migration.
 */
const UNIFIED_SCORES_CTE = `
  WITH unified_scores AS (
    SELECT sc.id, sc.user_id, sc.attempted_at AS occurred_at,
           CAST(sc.percentage AS FLOAT) AS percentage, sk.name AS skill_name, sk.slug AS skill_slug,
           COALESCE(sc.time_spent_minutes, 0) AS duration_minutes,
           COALESCE(pa.title, 'Activity') AS title
    FROM activity_scores sc
    LEFT JOIN skills sk ON sk.id = sc.skill_id
    LEFT JOIN planned_activities pa ON pa.id = sc.planned_activity_id AND pa.deleted_at IS NULL
    WHERE sc.deleted_at IS NULL

    UNION ALL

    SELECT att.id, att.user_id, att.submitted_at AS occurred_at,
           CAST(att.percentage AS FLOAT) AS percentage,
           CASE WHEN ex.part_code LIKE 'UOE_PART_%' THEN 'Use of English' ELSE 'Use of English' END AS skill_name,
           CASE WHEN ex.part_code LIKE 'UOE_PART_%' THEN 'use-of-english' ELSE 'use-of-english' END AS skill_slug,
           COALESCE(att.duration_seconds, 0) / 60.0 AS duration_minutes,
           ex.title AS title
    FROM practice_attempts att
    INNER JOIN practice_exercises ex ON ex.id = att.exercise_id
    WHERE att.deleted_at IS NULL AND att.status = 'completed'

    UNION ALL

    SELECT ws.id, ws.user_id, ws.submitted_at AS occurred_at,
           (CAST(ws.feedback->>'overallBand' AS FLOAT) / CAST(ws.feedback->>'maxBand' AS FLOAT)) * 100 AS percentage,
           'Writing' AS skill_name,
           'writing' AS skill_slug,
           COALESCE(ws.duration_seconds, 0) / 60.0 AS duration_minutes,
           wt.title AS title
    FROM writing_submissions ws
    INNER JOIN writing_tasks wt ON wt.id = ws.task_id
    WHERE ws.deleted_at IS NULL AND ws.status = 'graded'
  )
`;

class ProgressRepository {
  constructor(private readonly ds: DataSource) {}

  async getWeeklyActivityStats(
    userId: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<WeeklyActivityStats> {
    const row = await this.ds
      .createQueryBuilder(PlannedActivity, 'pa')
      .innerJoin(PlanDay, 'pd', 'pd.id = pa.plan_day_id')
      .innerJoin(WeeklyPlan, 'wp', 'wp.id = pd.weekly_plan_id')
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(CASE WHEN pa.status = 'completed' THEN 1 END)`, 'completed')
      .where('wp.user_id = :userId', { userId })
      .andWhere('wp.deleted_at IS NULL')
      .andWhere('pa.deleted_at IS NULL')
      .andWhere('wp.week_start_date <= :weekEnd', { weekEnd })
      .andWhere('wp.week_end_date >= :weekStart', { weekStart })
      .getRawOne<{ total: string; completed: string }>();

    return {
      total: parseInt(row?.total ?? '0', 10),
      completed: parseInt(row?.completed ?? '0', 10),
    };
  }

  async getWeeklyScoreStats(
    userId: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<WeeklyScoreStats> {
    const rows = await this.ds.query<{ avg_score: string | null; study_minutes: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT AVG(percentage) AS avg_score, COALESCE(SUM(duration_minutes), 0) AS study_minutes
       FROM unified_scores
       WHERE user_id = $1 AND occurred_at >= $2::date AND occurred_at < ($3::date + INTERVAL '1 day')`,
      [userId, weekStart, weekEnd],
    );
    const row = rows[0];

    const avg = row?.avg_score != null ? parseFloat(row.avg_score) : null;

    return {
      avgScore: avg !== null && !isNaN(avg) ? avg : null,
      studyMinutes: Math.round(parseFloat(row?.study_minutes ?? '0')),
    };
  }

  async getSkillAverages(userId: string, since: string): Promise<SkillAverage[]> {
    const rows = await this.ds.query<{ skillName: string; avgScore: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT skill_name AS "skillName", AVG(percentage) AS "avgScore"
       FROM unified_scores
       WHERE user_id = $1 AND skill_name IS NOT NULL AND percentage IS NOT NULL AND occurred_at >= $2::date
       GROUP BY skill_name
       ORDER BY skill_name ASC`,
      [userId, since],
    );

    return rows.map((r) => ({
      skillName: r.skillName,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  async getStudyDates(userId: string): Promise<string[]> {
    const rows = await this.ds.query<{ study_date: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT TO_CHAR(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS study_date
       FROM unified_scores
       WHERE user_id = $1
       GROUP BY study_date
       ORDER BY study_date DESC`,
      [userId],
    );

    return rows.map((r) => r.study_date);
  }

  async getLastMock(userId: string): Promise<MockTest | null> {
    return this.ds
      .createQueryBuilder(MockTest, 'mt')
      .where('mt.user_id = :userId', { userId })
      .andWhere('mt.deleted_at IS NULL')
      .orderBy('mt.taken_at', 'DESC', 'NULLS LAST')
      .addOrderBy('mt.created_at', 'DESC')
      .getOne();
  }

  async getMonthlySkillProgress(userId: string, since: string): Promise<SkillWeekRow[]> {
    const rows = await this.ds.query<{ skillName: string; weekStart: string; avgScore: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT skill_name AS "skillName", TO_CHAR(DATE_TRUNC('week', occurred_at), 'YYYY-MM-DD') AS "weekStart",
              AVG(percentage) AS "avgScore"
       FROM unified_scores
       WHERE user_id = $1 AND skill_name IS NOT NULL AND percentage IS NOT NULL AND occurred_at >= $2::date
       GROUP BY skill_name, DATE_TRUNC('week', occurred_at)
       ORDER BY skill_name ASC, DATE_TRUNC('week', occurred_at) ASC`,
      [userId, since],
    );

    return rows.map((r) => ({
      skillName: r.skillName,
      weekStart: r.weekStart,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  async getRecentActivities(userId: string, limit: number): Promise<RecentActivityRow[]> {
    const rows = await this.ds.query<
      { id: string; title: string; skillName: string | null; score: string | null; date: string }[]
    >(
      `${UNIFIED_SCORES_CTE}
       SELECT id, title, skill_name AS "skillName", percentage AS score,
              TO_CHAR(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date
       FROM unified_scores
       WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      skillName: r.skillName,
      score: r.score !== null ? parseFloat(r.score) || null : null,
      date: r.date,
    }));
  }

  /**
   * Raw, per-attempt rows (not pre-aggregated) for the Progress screen's
   * skill evolution chart and ranking — those need individual data points
   * to sample/downsample per selected period, unlike the weekly-averaged
   * methods above. Deliberately NOT the same data GET /scores (ScoringService.
   * getScoreHistory) returns: that endpoint backs the editable score list
   * (edit/delete a manually-logged ActivityScore) and only ever reads
   * ActivityScore — Practice/Writing rows have no "edit" affordance, so
   * they never belong in that list. This is a separate, read-only
   * analytics view over the same unified_scores CTE.
   */
  async getScoreEvolution(
    userId: string,
    from: string,
    to: string,
  ): Promise<ScoreEvolutionRow[]> {
    const rows = await this.ds.query<
      { occurredAt: Date; skillSlug: string | null; skillName: string | null; percentage: string }[]
    >(
      `${UNIFIED_SCORES_CTE}
       SELECT occurred_at AS "occurredAt", skill_slug AS "skillSlug", skill_name AS "skillName", percentage
       FROM unified_scores
       WHERE user_id = $1 AND skill_slug IS NOT NULL AND percentage IS NOT NULL
         AND occurred_at >= $2::date AND occurred_at < ($3::date + INTERVAL '1 day')
       ORDER BY occurred_at ASC`,
      [userId, from, to],
    );

    return rows
      .filter((r): r is typeof r & { skillSlug: string; skillName: string } => r.skillSlug !== null)
      .map((r) => ({
        occurredAt: r.occurredAt,
        skillSlug: r.skillSlug,
        skillName: r.skillName,
        percentage: parseFloat(r.percentage) || 0,
      }));
  }

  async getActiveGoal(userId: string): Promise<UserGoal | null> {
    return this.ds
      .createQueryBuilder(UserGoal, 'ug')
      .where('ug.user_id = :userId', { userId })
      .andWhere('ug.deleted_at IS NULL')
      .andWhere(`ug.status = 'active'`)
      .andWhere('ug.target_date IS NOT NULL')
      .andWhere('ug.target_exam IS NOT NULL')
      .orderBy('ug.created_at', 'DESC')
      .getOne();
  }

  async getOverallWeeklyScores(userId: string, since: string): Promise<OverallWeekRow[]> {
    const rows = await this.ds.query<{ weekStart: string; avgScore: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT TO_CHAR(DATE_TRUNC('week', occurred_at), 'YYYY-MM-DD') AS "weekStart",
              AVG(percentage) AS "avgScore"
       FROM unified_scores
       WHERE user_id = $1 AND percentage IS NOT NULL AND occurred_at >= $2::date
       GROUP BY DATE_TRUNC('week', occurred_at)
       ORDER BY DATE_TRUNC('week', occurred_at) ASC`,
      [userId, since],
    );

    return rows.map((r) => ({
      weekStart: r.weekStart,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  /**
   * Completed practice attempts grouped by the exact exam paper part. This
   * intentionally does not use ActivityScore: Practice attempts have their
   * own reliable counts and percentage, and are not categorised as Skills.
   */
  async getPracticePartMetrics(userId: string): Promise<PracticePartMetricRow[]> {
    const rows = await this.ds
      .createQueryBuilder(PracticeAttempt, 'attempt')
      .innerJoin(
        PracticeExercise,
        'exercise',
        'exercise.id = attempt.exercise_id AND exercise.deleted_at IS NULL',
      )
      .select('exercise.exam_code', 'examCode')
      .addSelect('exercise.paper_code', 'paperCode')
      .addSelect('exercise.part_code', 'partCode')
      .addSelect('COUNT(attempt.id)', 'completedAttempts')
      .addSelect('COALESCE(SUM(attempt.correct_count), 0)', 'correctCount')
      .addSelect('COALESCE(SUM(attempt.total_count), 0)', 'totalCount')
      .addSelect('AVG(CAST(attempt.percentage AS FLOAT))', 'averageScore')
      .addSelect('MAX(attempt.submitted_at)', 'lastAttemptAt')
      .where('attempt.user_id = :userId', { userId })
      .andWhere('attempt.deleted_at IS NULL')
      .andWhere('attempt.status = :status', { status: PracticeAttemptStatus.COMPLETED })
      .groupBy('exercise.exam_code')
      .addGroupBy('exercise.paper_code')
      .addGroupBy('exercise.part_code')
      .orderBy('exercise.exam_code', 'ASC')
      .addOrderBy('exercise.paper_code', 'ASC')
      .addOrderBy('exercise.part_code', 'ASC')
      .getRawMany<{
        examCode: string;
        paperCode: string;
        partCode: string;
        completedAttempts: string;
        correctCount: string;
        totalCount: string;
        averageScore: string;
        lastAttemptAt: Date;
      }>();

    return rows.map((row) => ({
      examCode: row.examCode,
      paperCode: row.paperCode,
      partCode: row.partCode,
      completedAttempts: parseInt(row.completedAttempts, 10),
      correctCount: parseInt(row.correctCount, 10),
      totalCount: parseInt(row.totalCount, 10),
      averageScore: parseFloat(row.averageScore),
      lastAttemptAt: row.lastAttemptAt,
    }));
  }

  /**
   * Average band per Cambridge Writing criterion across all graded
   * submissions, plus a summary row — mirrors getPracticePartMetrics'
   * shape/intent, just grouping by criterion (from the feedback JSONB)
   * instead of by exam part. Two small parameterized queries in parallel
   * rather than one combined query with window functions, for readability.
   */
  async getWritingMetrics(
    userId: string,
  ): Promise<{ criteria: WritingCriterionMetricRow[]; summary: WritingMetricsSummaryRow }> {
    const [criteriaRows, summaryRows] = await Promise.all([
      this.ds.query<{ criterion: string; averageBand: string }[]>(
        `SELECT c->>'criterion' AS criterion, AVG((c->>'band')::float) AS "averageBand"
         FROM writing_submissions ws
         CROSS JOIN LATERAL jsonb_array_elements(ws.feedback->'criteria') AS c
         WHERE ws.user_id = $1 AND ws.deleted_at IS NULL AND ws.status = 'graded'
         GROUP BY c->>'criterion'
         ORDER BY c->>'criterion' ASC`,
        [userId],
      ),
      this.ds.query<
        { completedCount: string; overallAverageBand: string | null; lastAttemptAt: Date | null }[]
      >(
        `SELECT COUNT(*) AS "completedCount",
                AVG(CAST(feedback->>'overallBand' AS FLOAT)) AS "overallAverageBand",
                MAX(submitted_at) AS "lastAttemptAt"
         FROM writing_submissions
         WHERE user_id = $1 AND deleted_at IS NULL AND status = 'graded'`,
        [userId],
      ),
    ]);

    const summaryRow = summaryRows[0];

    return {
      criteria: criteriaRows.map((row) => ({
        criterion: row.criterion,
        averageBand: parseFloat(row.averageBand) || 0,
      })),
      summary: {
        completedCount: parseInt(summaryRow?.completedCount ?? '0', 10),
        overallAverageBand:
          summaryRow?.overallAverageBand != null ? parseFloat(summaryRow.overallAverageBand) : null,
        lastAttemptAt: summaryRow?.lastAttemptAt ?? null,
      },
    };
  }
}

export { ProgressRepository };
export type {
  WeeklyActivityStats,
  WeeklyScoreStats,
  SkillAverage,
  SkillWeekRow,
  RecentActivityRow,
  OverallWeekRow,
  ScoreEvolutionRow,
  PracticePartMetricRow,
  WritingCriterionMetricRow,
  WritingMetricsSummaryRow,
};
