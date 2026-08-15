export interface WeeklyActivitiesMetric {
  completed: number;
  planned: number;
}

export interface SkillMetric {
  skill: string;
  score: number;
}

export interface LastMockMetric {
  id: string;
  name: string;
  date: string | null;
  standardizedScore: number | null;
  scoreScale: string;
}

export interface SkillProgressMetric {
  skill: string;
  weeklyScores: (number | null)[];
}

export interface RecentActivityMetric {
  id: string;
  title: string;
  skill: string | null;
  score: number | null;
  date: string;
}

export interface ExamGoalMetric {
  examName: string;
  targetDate: string;
  daysUntilExam: number;
}

/** Aggregate performance for one concrete Cambridge exam part (for example UOE_PART_1). */
export interface PracticePartMetric {
  examCode: string;
  paperCode: string;
  partCode: string;
  completedAttempts: number;
  correctCount: number;
  totalCount: number;
  averageScore: number;
  lastAttemptAt: string;
}

export interface PracticePartMetricsResponse {
  parts: PracticePartMetric[];
}

/** Average band for one of the 4 official Cambridge Writing criteria, across all graded submissions. */
export interface WritingCriterionMetric {
  criterion: string;
  averageBand: number;
  maxBand: 5;
}

export interface WritingMetricsResponse {
  criteria: WritingCriterionMetric[];
  overallAverageBand: number | null;
  maxBand: 20;
  completedCount: number;
  lastAttemptAt: string | null;
}

export interface MetricsResponse {
  weeklyActivities: WeeklyActivitiesMetric;
  studyMinutes: number;
  weeklyAvgScore: number | null;
  strongestSkill: SkillMetric | null;
  weakestSkill: SkillMetric | null;
  studyStreak: number;
  lastMock: LastMockMetric | null;
  monthlyProgressBySkill: SkillProgressMetric[];
  overallWeeklyScores: (number | null)[];
  recentActivities: RecentActivityMetric[];
  examGoal: ExamGoalMetric | null;
}
