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
  cambridgeScale: number | null;
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
