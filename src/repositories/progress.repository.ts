import type { DataSource } from 'typeorm';
import { PlannedActivity } from '../models/PlannedActivity';
import { PlanDay } from '../models/PlanDay';
import { WeeklyPlan } from '../models/WeeklyPlan';
import { ActivityScore } from '../models/ActivityScore';
import { MockTest } from '../models/MockTest';
import { UserGoal } from '../models/UserGoal';
import { Skill } from '../models/Skill';
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
    const row = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .select('AVG(CAST(sc.percentage AS FLOAT))', 'avg_score')
      .addSelect('COALESCE(SUM(sc.time_spent_minutes), 0)', 'study_minutes')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .andWhere(`sc.attempted_at >= :weekStart::date`, { weekStart })
      .andWhere(`sc.attempted_at < (:weekEnd::date + INTERVAL '1 day')`, { weekEnd })
      .getRawOne<{ avg_score: string | null; study_minutes: string }>();

    const avg = row?.avg_score != null ? parseFloat(row.avg_score) : null;

    return {
      avgScore: avg !== null && !isNaN(avg) ? avg : null,
      studyMinutes: parseInt(row?.study_minutes ?? '0', 10),
    };
  }

  async getSkillAverages(userId: string, since: string): Promise<SkillAverage[]> {
    const rows = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .innerJoin('sc.skill', 'sk')
      .select('sk.name', 'skillName')
      .addSelect('AVG(CAST(sc.percentage AS FLOAT))', 'avgScore')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .andWhere('sc.percentage IS NOT NULL')
      .andWhere(`sc.attempted_at >= :since::date`, { since })
      .groupBy('sk.id')
      .addGroupBy('sk.name')
      .orderBy('sk.name', 'ASC')
      .getRawMany<{ skillName: string; avgScore: string }>();

    return rows.map((r) => ({
      skillName: r.skillName,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  async getStudyDates(userId: string): Promise<string[]> {
    const rows = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .select(`TO_CHAR(sc.attempted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, 'study_date')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .groupBy(`TO_CHAR(sc.attempted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
      .orderBy('study_date', 'DESC')
      .getRawMany<{ study_date: string }>();

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
    const rows = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .innerJoin('sc.skill', 'sk')
      .select('sk.name', 'skillName')
      .addSelect(`TO_CHAR(DATE_TRUNC('week', sc.attempted_at), 'YYYY-MM-DD')`, 'weekStart')
      .addSelect('AVG(CAST(sc.percentage AS FLOAT))', 'avgScore')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .andWhere('sc.percentage IS NOT NULL')
      .andWhere(`sc.attempted_at >= :since::date`, { since })
      .groupBy('sk.id')
      .addGroupBy('sk.name')
      .addGroupBy(`DATE_TRUNC('week', sc.attempted_at)`)
      .orderBy('sk.name', 'ASC')
      .addOrderBy(`DATE_TRUNC('week', sc.attempted_at)`, 'ASC')
      .getRawMany<{ skillName: string; weekStart: string; avgScore: string }>();

    return rows.map((r) => ({
      skillName: r.skillName,
      weekStart: r.weekStart,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }

  async getRecentActivities(userId: string, limit: number): Promise<RecentActivityRow[]> {
    const rows = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .leftJoin(PlannedActivity, 'pa', 'pa.id = sc.planned_activity_id AND pa.deleted_at IS NULL')
      .leftJoin(Skill, 'sk', 'sk.id = sc.skill_id')
      .select('sc.id', 'id')
      .addSelect(`COALESCE(pa.title, 'Activity')`, 'title')
      .addSelect('sk.name', 'skillName')
      .addSelect('CAST(sc.percentage AS FLOAT)', 'score')
      .addSelect(`TO_CHAR(sc.attempted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, 'date')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .orderBy('sc.attempted_at', 'DESC')
      .limit(limit)
      .getRawMany<{
        id: string;
        title: string;
        skillName: string | null;
        score: string | null;
        date: string;
      }>();

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      skillName: r.skillName,
      score: r.score !== null ? parseFloat(r.score) || null : null,
      date: r.date,
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
    const rows = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .select(`TO_CHAR(DATE_TRUNC('week', sc.attempted_at), 'YYYY-MM-DD')`, 'weekStart')
      .addSelect('AVG(CAST(sc.percentage AS FLOAT))', 'avgScore')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .andWhere('sc.percentage IS NOT NULL')
      .andWhere(`sc.attempted_at >= :since::date`, { since })
      .groupBy(`DATE_TRUNC('week', sc.attempted_at)`)
      .orderBy(`DATE_TRUNC('week', sc.attempted_at)`, 'ASC')
      .getRawMany<{ weekStart: string; avgScore: string }>();

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
}

export { ProgressRepository };
export type {
  WeeklyActivityStats,
  WeeklyScoreStats,
  SkillAverage,
  SkillWeekRow,
  RecentActivityRow,
  OverallWeekRow,
  PracticePartMetricRow,
};
