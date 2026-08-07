export type PracticeLocale = 'en' | 'es';
export interface PracticeMetric {
  code: string;
  itemCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  percentage: number;
}
export interface PracticeInsights {
  sample: {
    attemptCount: number;
    itemCount: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
  };
  overall: { percentage: number; averageDurationSeconds: number | null };
  byPart: Array<PracticeMetric & { examCode: string; paperCode: string; partCode: string }>;
  bySkill: PracticeMetric[];
  strengths: string[];
  focusAreas: string[];
  trend: {
    direction: 'improving' | 'declining' | 'stable';
    recentPercentage: number;
    previousPercentage: number;
    deltaPercentage: number;
  } | null;
  eligibleForRecommendation: boolean;
}
export interface PracticeRecommendation {
  summary: string;
  strengths: string[];
  focusAreas: string[];
  recommendedPractice: { examCode: string; paperCode: string; partCode: string; reason: string };
  studyTips: string[];
}
