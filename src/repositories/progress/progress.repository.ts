import type { DataSource } from 'typeorm';
import { PlannedActivity } from '@models/PlannedActivity';
import { PlanDay } from '@models/PlanDay';
import { WeeklyPlan } from '@models/WeeklyPlan';
import { MockTest } from '@models/MockTest';
import { UserGoal } from '@models/UserGoal';

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

interface ExamPartMetricRow {
  sectionSlug: string;
  sectionName: string;
  skillSlug: string;
  skillName: string;
  completedAttempts: number;
  correctCount: number | null;
  totalCount: number | null;
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
    timeZone: string,
  ): Promise<WeeklyScoreStats> {
    const rows = await this.ds.query<{ avg_score: string | null; study_minutes: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT AVG(percentage) AS avg_score, COALESCE(SUM(duration_minutes), 0) AS study_minutes
       FROM unified_scores
       WHERE user_id = $1
         AND occurred_at >= ($2::timestamp AT TIME ZONE $4)
         AND occurred_at < (($3::timestamp + INTERVAL '1 day') AT TIME ZONE $4)`,
      [userId, weekStart, weekEnd, timeZone],
    );
    const row = rows[0];

    const avg = row?.avg_score != null ? parseFloat(row.avg_score) : null;

    return {
      avgScore: avg !== null && !isNaN(avg) ? avg : null,
      studyMinutes: Math.round(parseFloat(row?.study_minutes ?? '0')),
    };
  }

  /**
   * from/to are the USER's calendar days (the client builds them from local
   * components), so the window has to be opened in the user's zone too.
   * `$n::date` alone is midnight UTC: with a local 'to' of the 21st that cuts
   * the window at 18:00 local, silently dropping every activity done that
   * evening.
   */
  async getSkillAverages(userId: string, since: string, timeZone: string): Promise<SkillAverage[]> {
    const rows = await this.ds.query<{ skillName: string; avgScore: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT skill_name AS "skillName", AVG(percentage) AS "avgScore"
       FROM unified_scores
       WHERE user_id = $1 AND skill_name IS NOT NULL AND percentage IS NOT NULL
         AND occurred_at >= ($2::timestamp AT TIME ZONE $3)
       GROUP BY skill_name
       ORDER BY skill_name ASC`,
      [userId, since, timeZone],
    );

    return rows.map((r) => ({
      skillName: r.skillName,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  /**
   * Distinct days the user studied, in THEIR timezone — this is what the
   * study streak counts. Bucketing by the UTC day (as this used to) both
   * broke and inflated streaks west of Greenwich: an evening session and the
   * next morning's collapse into one UTC day, while a single Friday-evening
   * session registers as Saturday.
   */
  async getStudyDates(userId: string, timeZone: string): Promise<string[]> {
    const rows = await this.ds.query<{ study_date: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT TO_CHAR(occurred_at AT TIME ZONE $2, 'YYYY-MM-DD') AS study_date
       FROM unified_scores
       WHERE user_id = $1
       GROUP BY study_date
       ORDER BY study_date DESC`,
      [userId, timeZone],
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

  /**
   * Weeks are the user's weeks. A bare DATE_TRUNC('week', occurred_at) on a
   * timestamptz truncates in the CONNECTION's timezone (UTC here), so a
   * Sunday-evening session fell into the following week's bucket.
   */
  async getMonthlySkillProgress(
    userId: string,
    since: string,
    timeZone: string,
  ): Promise<SkillWeekRow[]> {
    const rows = await this.ds.query<{ skillName: string; weekStart: string; avgScore: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT skill_name AS "skillName",
              TO_CHAR(DATE_TRUNC('week', occurred_at AT TIME ZONE $3), 'YYYY-MM-DD') AS "weekStart",
              AVG(percentage) AS "avgScore"
       FROM unified_scores
       WHERE user_id = $1 AND skill_name IS NOT NULL AND percentage IS NOT NULL
         AND occurred_at >= ($2::timestamp AT TIME ZONE $3)
       GROUP BY skill_name, DATE_TRUNC('week', occurred_at AT TIME ZONE $3)
       ORDER BY skill_name ASC, DATE_TRUNC('week', occurred_at AT TIME ZONE $3) ASC`,
      [userId, since, timeZone],
    );

    return rows.map((r) => ({
      skillName: r.skillName,
      weekStart: r.weekStart,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  /**
   * `date` is a display value the client renders as a weekday ("Vie", "Hoy"),
   * so it has to be the user's calendar day. Formatting the instant in UTC
   * made anything finished after ~18:00 west of Greenwich show up as the
   * following day.
   */
  async getRecentActivities(
    userId: string,
    limit: number,
    timeZone: string,
  ): Promise<RecentActivityRow[]> {
    const rows = await this.ds.query<
      { id: string; title: string; skillName: string | null; score: string | null; date: string }[]
    >(
      `${UNIFIED_SCORES_CTE}
       SELECT id, title, skill_name AS "skillName", percentage AS score,
              TO_CHAR(occurred_at AT TIME ZONE $3, 'YYYY-MM-DD') AS date
       FROM unified_scores
       WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [userId, limit, timeZone],
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
   *
   * Mock exam sections are unioned in here only — not into
   * UNIFIED_SCORES_CTE itself — because mocks are paper-level only
   * (READING, USE_OF_ENGLISH, WRITING, LISTENING, SPEAKING; see
   * MOCK_EXAM_CATALOG), so they can resolve to a Skill but never to the
   * per-Cambridge-part granularity the Home dashboard methods sharing that
   * CTE would otherwise imply. Keeping them scoped to this method means a
   * logged mock only moves "Evolución por skill", not the Home weekly
   * average/streak. C1's combined READING_AND_USE_OF_ENGLISH section
   * doesn't map to a single skill and is left NULL, same as any other
   * unmapped row.
   */
  /**
   * from/to are the USER's calendar days (the client builds them from local
   * components), so the window has to be opened in the user's zone too.
   * `$n::date` alone is midnight UTC: with a local 'to' of the 21st that cuts
   * the window at 18:00 local, silently dropping every activity done that
   * evening.
   */
  async getScoreEvolution(
    userId: string,
    from: string,
    to: string,
    timeZone: string,
  ): Promise<ScoreEvolutionRow[]> {
    const rows = await this.ds.query<
      { occurredAt: Date; skillSlug: string | null; skillName: string | null; percentage: string }[]
    >(
      `${UNIFIED_SCORES_CTE},
       mock_scores AS (
         -- Prefers the real skill resolved via exam_section_id (part-level
         -- B2_FIRST mocks, every skill except Speaking) and falls back to
         -- the paper-code CASE for historical/non-B2_FIRST rows and
         -- Speaking, which never gets an exam_section_id (see
         -- mock-exam-catalog.ts).
         SELECT CAST(mss.percentage AS FLOAT) AS percentage,
                COALESCE(mt.taken_at, mt.created_at) AS occurred_at,
                COALESCE(sk_part.slug, CASE mss.section_code
                  WHEN 'READING' THEN 'reading'
                  WHEN 'USE_OF_ENGLISH' THEN 'use-of-english'
                  WHEN 'WRITING' THEN 'writing'
                  WHEN 'LISTENING' THEN 'listening'
                  WHEN 'SPEAKING' THEN 'speaking'
                  ELSE NULL
                END) AS skill_slug,
                COALESCE(sk_part.name, CASE mss.section_code
                  WHEN 'READING' THEN 'Reading'
                  WHEN 'USE_OF_ENGLISH' THEN 'Use of English'
                  WHEN 'WRITING' THEN 'Writing'
                  WHEN 'LISTENING' THEN 'Listening'
                  WHEN 'SPEAKING' THEN 'Speaking'
                  ELSE NULL
                END) AS skill_name
         FROM mock_section_scores mss
         INNER JOIN mock_tests mt ON mt.id = mss.mock_test_id AND mt.deleted_at IS NULL
         LEFT JOIN exam_sections es_part ON es_part.id = mss.exam_section_id
         LEFT JOIN skills sk_part ON sk_part.id = es_part.skill_id
         WHERE mt.user_id = $1 AND mss.percentage IS NOT NULL
       )
       SELECT occurred_at AS "occurredAt", skill_slug AS "skillSlug", skill_name AS "skillName", percentage
       FROM unified_scores
       WHERE user_id = $1 AND skill_slug IS NOT NULL AND percentage IS NOT NULL
         AND occurred_at >= ($2::timestamp AT TIME ZONE $4)
         AND occurred_at < (($3::timestamp + INTERVAL '1 day') AT TIME ZONE $4)

       UNION ALL

       SELECT occurred_at AS "occurredAt", skill_slug AS "skillSlug", skill_name AS "skillName", percentage
       FROM mock_scores
       WHERE skill_slug IS NOT NULL
         AND occurred_at >= ($2::timestamp AT TIME ZONE $4)
         AND occurred_at < (($3::timestamp + INTERVAL '1 day') AT TIME ZONE $4)

       ORDER BY "occurredAt" ASC`,
      [userId, from, to, timeZone],
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

  /** Same user-week bucketing as getMonthlySkillProgress — see the note there. */
  async getOverallWeeklyScores(
    userId: string,
    since: string,
    timeZone: string,
  ): Promise<OverallWeekRow[]> {
    const rows = await this.ds.query<{ weekStart: string; avgScore: string }[]>(
      `${UNIFIED_SCORES_CTE}
       SELECT TO_CHAR(DATE_TRUNC('week', occurred_at AT TIME ZONE $3), 'YYYY-MM-DD') AS "weekStart",
              AVG(percentage) AS "avgScore"
       FROM unified_scores
       WHERE user_id = $1 AND percentage IS NOT NULL
         AND occurred_at >= ($2::timestamp AT TIME ZONE $3)
       GROUP BY DATE_TRUNC('week', occurred_at AT TIME ZONE $3)
       ORDER BY DATE_TRUNC('week', occurred_at AT TIME ZONE $3) ASC`,
      [userId, since, timeZone],
    );

    return rows.map((r) => ({
      weekStart: r.weekStart,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  /**
   * Completed attempts grouped by the exact Cambridge exam-section part,
   * unified across Practice attempts, graded Writing submissions, and
   * manually-logged activities that resolve to a real exam part. Mocks are
   * Mocks contribute only where they resolved a real exam_section_id —
   * B2_FIRST mocks logged after part-level registration shipped (see
   * mock-exam-catalog.ts), for every skill except Speaking, which stays a
   * holistic paper-level entry with no exam_section_id (see
   * getScoreEvolution for where paper-level mocks, and Speaking, still
   * count instead).
   *
   * Raw SQL (not QueryBuilder) for the same reason as UNIFIED_SCORES_CTE:
   * no clean way to UNION three structurally different tables otherwise.
   *
   * Practice's part_code is SCREAMING_SNAKE (e.g. UOE_PART_1);
   * exam_sections.slug is kebab-case (e.g. uoe-part-1) —
   * LOWER(REPLACE(part_code, '_', '-')) converts one to the other exactly.
   * Writing v1 is essay-only, which is exam_sections' 'writing-part-1'.
   * Activities resolve their exam section via
   * COALESCE(planned_activity, activity_template, custom_activity) —
   * whichever of those three has exam_section_id set first.
   *
   * correctCount/totalCount are Practice-only (SUM of columns that are NULL
   * for Writing/activity rows); a part with zero Practice attempts sums to
   * NULL, meaning no accuracy line — Writing has no accuracy concept either.
   */
  async getExamPartMetrics(userId: string): Promise<ExamPartMetricRow[]> {
    const rows = await this.ds.query<
      {
        sectionSlug: string;
        sectionName: string;
        skillSlug: string;
        skillName: string;
        completedAttempts: string;
        correctCount: string | null;
        totalCount: string | null;
        averageScore: string;
        lastAttemptAt: Date;
      }[]
    >(
      `WITH exam_part_rows AS (
         SELECT LOWER(REPLACE(ex.part_code, '_', '-')) AS section_slug,
                CAST(att.percentage AS FLOAT) AS percentage,
                att.correct_count, att.total_count, att.submitted_at AS occurred_at
         FROM practice_attempts att
         INNER JOIN practice_exercises ex ON ex.id = att.exercise_id
         WHERE att.user_id = $1 AND att.deleted_at IS NULL AND att.status = 'completed'

         UNION ALL

         SELECT 'writing-part-1' AS section_slug,
                (CAST(ws.feedback->>'overallBand' AS FLOAT) / CAST(ws.feedback->>'maxBand' AS FLOAT)) * 100,
                NULL, NULL, ws.submitted_at
         FROM writing_submissions ws
         WHERE ws.user_id = $1 AND ws.deleted_at IS NULL AND ws.status = 'graded'

         UNION ALL

         SELECT es.slug AS section_slug, CAST(sc.percentage AS FLOAT), NULL, NULL, sc.attempted_at
         FROM activity_scores sc
         INNER JOIN planned_activities pa ON pa.id = sc.planned_activity_id AND pa.deleted_at IS NULL
         LEFT JOIN activity_templates atpl ON atpl.id = pa.activity_template_id
         LEFT JOIN custom_activities ca ON ca.id = pa.custom_activity_id
         INNER JOIN exam_sections es
           ON es.id = COALESCE(pa.exam_section_id, atpl.exam_section_id, ca.exam_section_id)
         WHERE sc.user_id = $1 AND sc.deleted_at IS NULL AND sc.percentage IS NOT NULL

         UNION ALL

         SELECT es.slug AS section_slug, CAST(mss.percentage AS FLOAT), NULL, NULL,
                COALESCE(mt.taken_at, mt.created_at)
         FROM mock_section_scores mss
         INNER JOIN mock_tests mt ON mt.id = mss.mock_test_id AND mt.deleted_at IS NULL
         INNER JOIN exam_sections es ON es.id = mss.exam_section_id
         WHERE mt.user_id = $1 AND mss.percentage IS NOT NULL
       )
       SELECT es.slug AS "sectionSlug", es.name AS "sectionName",
              sk.slug AS "skillSlug", sk.name AS "skillName",
              COUNT(*) AS "completedAttempts",
              SUM(epr.correct_count) AS "correctCount", SUM(epr.total_count) AS "totalCount",
              AVG(epr.percentage) AS "averageScore", MAX(epr.occurred_at) AS "lastAttemptAt"
       FROM exam_part_rows epr
       INNER JOIN exam_sections es ON es.slug = epr.section_slug
       INNER JOIN skills sk ON sk.id = es.skill_id
       GROUP BY es.slug, es.name, sk.slug, sk.name
       ORDER BY sk.slug ASC, es.slug ASC`,
      [userId],
    );

    return rows.map((row) => ({
      sectionSlug: row.sectionSlug,
      sectionName: row.sectionName,
      skillSlug: row.skillSlug,
      skillName: row.skillName,
      completedAttempts: parseInt(row.completedAttempts, 10),
      correctCount: row.correctCount !== null ? parseInt(row.correctCount, 10) : null,
      totalCount: row.totalCount !== null ? parseInt(row.totalCount, 10) : null,
      averageScore: parseFloat(row.averageScore),
      lastAttemptAt: row.lastAttemptAt,
    }));
  }

  /**
   * Average band per Cambridge Writing criterion across all graded
   * submissions, plus a summary row — mirrors getExamPartMetrics'
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
  ExamPartMetricRow,
  WritingCriterionMetricRow,
  WritingMetricsSummaryRow,
};
