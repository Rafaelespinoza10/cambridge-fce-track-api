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

/**
 * Aggregate performance for one concrete Cambridge exam-section part (for
 * example "Part 1 - Multiple Choice Cloze"), unified across Practice
 * attempts, Writing submissions, and manually-logged activities.
 * correctCount/totalCount are null when no Practice attempt contributed to
 * this part (Writing/activities have no accuracy concept).
 */
export interface ExamPartMetric {
  sectionSlug: string;
  sectionName: string;
  skillSlug: string;
  skillName: string;
  completedAttempts: number;
  correctCount: number | null;
  totalCount: number | null;
  averageScore: number;
  lastAttemptAt: string;
}

export interface ExamPartMetricsResponse {
  parts: ExamPartMetric[];
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

/**
 * One raw, per-attempt data point — not pre-aggregated — powering the
 * Progress screen's skill evolution chart and ranking. Deliberately not
 * SafeScore: those rows are editable (id, scoreType, correctAnswers, ...);
 * these are read-only analytics points that can come from a manually-
 * logged activity, a Practice attempt, or a Writing submission alike.
 */
export interface ScoreEvolutionEntrySkill {
  slug: string;
  name: string;
  accentColor: string;
}

export interface ScoreEvolutionEntry {
  attemptedAt: string;
  skill: ScoreEvolutionEntrySkill;
  percentage: number;
}

export interface ScoreEvolutionResponse {
  scores: ScoreEvolutionEntry[];
}

/**
 * One completed, graded B2 First mock's estimated Cambridge Scale Score —
 * powers the Progress screen's mock score trend line chart. Only ever
 * populated for mocks with a computed estimate (see
 * StartMockAttemptService/SubmitMockAttemptService and
 * estimate-mock-level.ts); mocks logged before that feature shipped, or for
 * exam types the estimate doesn't cover, are excluded rather than shown
 * with a null score.
 */
export interface MockScoreTrendPoint {
  takenAt: string;
  standardizedScore: number;
  level: string;
}

/** One CEFR level's score range on the Cambridge Scale (100-190) — see LEVEL_BANDS. */
export interface MockScoreTrendBand {
  level: string;
  minScore: number;
  maxScore: number;
}

export interface MockScoreTrendResponse {
  points: MockScoreTrendPoint[];
  bands: MockScoreTrendBand[];
  scoreScaleMin: number;
  scoreScaleMax: number;
}

/** One calendar day's activity count, in the user's own timezone — powers the GitHub-style activity heatmap. Days with zero activity are simply absent. */
export interface ActivityHeatmapDay {
  date: string;
  count: number;
}

export interface ActivityHeatmapResponse {
  days: ActivityHeatmapDay[];
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
