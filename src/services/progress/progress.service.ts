import { getDatabaseConnection } from '../../lib/database';
import { ProgressRepository } from '../../repositories/progress.repository';
import {
  calculateStreak,
  getCurrentWeekBounds,
  getLastNWeekStarts,
  roundTwo,
} from '@lib/progress-library';
import type {
  ExamGoalMetric,
  LastMockMetric,
  MetricsResponse,
  PracticePartMetricsResponse,
  RecentActivityMetric,
  SkillMetric,
  SkillProgressMetric,
} from '../../interfaces/progress/progress.interface';

const SKILL_LOOKBACK_DAYS = 30;
const MONTHLY_WEEKS = 4;
const RECENT_ACTIVITIES_LIMIT = 5;

class ProgressService {
  async getMetrics(userId: string): Promise<MetricsResponse> {
    const ds = await getDatabaseConnection();
    const repo = new ProgressRepository(ds);

    const { weekStart, weekEnd } = getCurrentWeekBounds();
    const weekStarts = getLastNWeekStarts(MONTHLY_WEEKS);
    const skillLookbackDate = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - SKILL_LOOKBACK_DAYS);
      return d.toISOString().split('T')[0]!;
    })();

    const [
      activityStats,
      scoreStats,
      skillAverages,
      studyDates,
      lastMock,
      monthlyRows,
      recentRows,
      activeGoal,
      overallRows,
    ] = await Promise.all([
      repo.getWeeklyActivityStats(userId, weekStart, weekEnd),
      repo.getWeeklyScoreStats(userId, weekStart, weekEnd),
      repo.getSkillAverages(userId, skillLookbackDate),
      repo.getStudyDates(userId),
      repo.getLastMock(userId),
      repo.getMonthlySkillProgress(userId, weekStarts[0]!),
      repo.getRecentActivities(userId, RECENT_ACTIVITIES_LIMIT),
      repo.getActiveGoal(userId),
      repo.getOverallWeeklyScores(userId, weekStarts[0]!),
    ]);

    // ── Strongest / weakest skill ──────────────────────────────────────────────
    let strongestSkill: SkillMetric | null = null;
    let weakestSkill: SkillMetric | null = null;

    if (skillAverages.length > 0) {
      const sorted = [...skillAverages].sort((a, b) => b.avgScore - a.avgScore);
      const best = sorted[0]!;
      const worst = sorted[sorted.length - 1]!;
      strongestSkill = { skill: best.skillName, score: roundTwo(best.avgScore) };
      if (sorted.length > 1) {
        weakestSkill = { skill: worst.skillName, score: roundTwo(worst.avgScore) };
      }
    }

    // ── Last mock ──────────────────────────────────────────────────────────────
    let lastMockMetric: LastMockMetric | null = null;
    if (lastMock !== null) {
      lastMockMetric = {
        id: lastMock.id,
        name: lastMock.name,
        date: lastMock.taken_at ? lastMock.taken_at.toISOString().split('T')[0]! : null,
        cambridgeScale: lastMock.estimated_cambridge_score,
      };
    }

    // ── Monthly progress by skill ──────────────────────────────────────────────
    const skillMap = new Map<string, Map<string, number>>();
    for (const row of monthlyRows) {
      if (!skillMap.has(row.skillName)) {
        skillMap.set(row.skillName, new Map());
      }
      skillMap.get(row.skillName)!.set(row.weekStart, roundTwo(row.avgScore));
    }

    const monthlyProgressBySkill: SkillProgressMetric[] = [];
    for (const [skill, weekData] of skillMap) {
      const weeklyScores = weekStarts.map((ws) => weekData.get(ws) ?? null);
      monthlyProgressBySkill.push({ skill, weeklyScores });
    }
    monthlyProgressBySkill.sort((a, b) => a.skill.localeCompare(b.skill));

    // ── Recent activities ──────────────────────────────────────────────────────
    const recentActivities: RecentActivityMetric[] = recentRows.map((r) => ({
      id: r.id,
      title: r.title,
      skill: r.skillName,
      score: r.score !== null ? roundTwo(r.score) : null,
      date: r.date,
    }));

    // ── Exam goal ──────────────────────────────────────────────────────────────
    let examGoal: ExamGoalMetric | null = null;
    if (activeGoal !== null && activeGoal.target_date !== null && activeGoal.target_exam !== null) {
      const todayMs = new Date().setUTCHours(0, 0, 0, 0);
      const examMs = new Date(activeGoal.target_date).getTime();
      const daysUntilExam = Math.ceil((examMs - todayMs) / 86_400_000);
      examGoal = {
        examName: activeGoal.target_exam,
        targetDate: activeGoal.target_date,
        daysUntilExam,
      };
    }

    // ── Overall weekly scores ──────────────────────────────────────────────────
    const overallMap = new Map(overallRows.map((r) => [r.weekStart, roundTwo(r.avgScore)]));
    const overallWeeklyScores = weekStarts.map((ws) => overallMap.get(ws) ?? null);

    return {
      weeklyActivities: {
        completed: activityStats.completed,
        planned: activityStats.total,
      },
      studyMinutes: scoreStats.studyMinutes,
      weeklyAvgScore: scoreStats.avgScore !== null ? roundTwo(scoreStats.avgScore) : null,
      strongestSkill,
      weakestSkill,
      studyStreak: calculateStreak(studyDates),
      lastMock: lastMockMetric,
      monthlyProgressBySkill,
      overallWeeklyScores,
      recentActivities,
      examGoal,
    };
  }

  async getPracticePartMetrics(userId: string): Promise<PracticePartMetricsResponse> {
    const ds = await getDatabaseConnection();
    const repo = new ProgressRepository(ds);
    const rows = await repo.getPracticePartMetrics(userId);

    return {
      parts: rows.map((row) => ({
        examCode: row.examCode,
        paperCode: row.paperCode,
        partCode: row.partCode,
        completedAttempts: row.completedAttempts,
        correctCount: row.correctCount,
        totalCount: row.totalCount,
        averageScore: roundTwo(row.averageScore),
        lastAttemptAt: row.lastAttemptAt.toISOString(),
      })),
    };
  }
}

export { ProgressService };
