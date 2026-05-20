import type { ScoreType } from '../models/enums';

export interface SafeSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface SafeExamSectionRef {
  id: string;
  name: string;
  slug: string;
}

export interface SafeExamSection {
  id: string;
  skillId: string;
  skill: SafeSkill;
  name: string;
  slug: string;
  description: string | null;
  maxScore: number | null;
  defaultDurationMinutes: number | null;
}

export interface SafeActivityTemplate {
  id: string;
  skillId: string;
  examSectionId: string | null;
  skill: SafeSkill;
  examSection: SafeExamSectionRef | null;
  name: string;
  description: string | null;
  scoreType: ScoreType;
  defaultDurationMinutes: number | null;
  maxScore: number | null;
  isActive: boolean;
}

export interface SafeCustomActivity {
  id: string;
  userId: string;
  skillId: string | null;
  examSectionId: string | null;
  name: string;
  description: string | null;
  scoreType: ScoreType | null;
  defaultDurationMinutes: number | null;
  maxScore: number | null;
}

export interface CreateCustomActivityBody {
  skillId?: string;
  examSectionId?: string;
  name: string;
  description?: string;
  scoreType: ScoreType;
  defaultDurationMinutes?: number;
  maxScore?: number;
}

export interface UpdateCustomActivityBody {
  skillId?: string | null;
  examSectionId?: string | null;
  name?: string;
  description?: string | null;
  scoreType?: ScoreType;
  defaultDurationMinutes?: number | null;
  maxScore?: number | null;
}

export interface ExamSectionFilters {
  skillId?: string;
  skillSlug?: string;
}

export interface ActivityTemplateFilters {
  skillId?: string;
  skillSlug?: string;
  examSectionId?: string;
  scoreType?: ScoreType;
  isActive?: boolean;
}

export interface CustomActivityFilters {
  skillId?: string;
  skillSlug?: string;
  examSectionId?: string;
  scoreType?: ScoreType;
}
