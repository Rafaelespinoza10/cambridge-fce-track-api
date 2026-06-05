import type { ScoreType, DifficultyLevel, ScoreCriterion } from '../models/enums';


export interface ScoreDetailInput {
  criterion: ScoreCriterion;
  score: number;
  maxScore?: number | null;
  notes?: string | null;
}

export interface RegisterScoreBody {
  scoreType: ScoreType;
  correctAnswers?: number | null;
  totalQuestions?: number | null;
  rawScore?: number | null;
  maxScore?: number | null;
  timeSpentMinutes?: number | null;
  difficulty?: DifficultyLevel | null;
  notes?: string | null;
  attemptedAt?: string | null;
  details?: ScoreDetailInput[] | null;
}

export interface UpdateScoreBody {
  correctAnswers?: number | null;
  totalQuestions?: number | null;
  rawScore?: number | null;
  maxScore?: number | null;
  timeSpentMinutes?: number | null;
  difficulty?: DifficultyLevel | null;
  notes?: string | null;
  attemptedAt?: string | null;
  details?: ScoreDetailInput[] | null;
}


export interface SafeScoreDetail {
  id: string;
  criterion: ScoreCriterion;
  score: number;
  maxScore: number | null;
  notes: string | null;
}

export interface SafeScoreSkill {
  id: string;
  slug: string;
  name: string;
  accentColor: string;
}

export interface SafeScore {
  id: string;
  plannedActivityId: string | null;
  skillId: string | null;
  skill: SafeScoreSkill | null;
  scoreType: ScoreType;
  correctAnswers: number | null;
  totalQuestions: number | null;
  percentage: number | null;
  rawScore: number | null;
  maxScore: number | null;
  timeSpentMinutes: number | null;
  difficulty: DifficultyLevel | null;
  notes: string | null;
  attemptedAt: Date;
  details: SafeScoreDetail[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ScoreHistoryFilters {
  skillId?: string;
  scoreType?: ScoreType;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
