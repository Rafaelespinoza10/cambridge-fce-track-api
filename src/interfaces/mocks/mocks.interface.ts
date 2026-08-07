import type { ExamType, MockType, EnglishLevel } from '../../models/enums';

// ── Section score maximums per spec section 8 ──────────────────────────────────

// ── Input interfaces ───────────────────────────────────────────────────────────

export interface SectionScoreInput {
  sectionCode: string;
  rawScore: number;
  maxScore?: number | null;
  standardizedScore?: number | null;
  notes?: string | null;
}

export interface CreateMockBody {
  name: string;
  examType?: ExamType | null;
  mockType?: MockType | null;
  takenAt?: string | null;
  estimatedStandardizedScore?: number | null;
  estimatedLevel?: EnglishLevel | null;
  notes?: string | null;
  sections?: SectionScoreInput[] | null;
}

export interface UpdateMockBody {
  name?: string;
  examType?: ExamType | null;
  mockType?: MockType | null;
  takenAt?: string | null;
  estimatedStandardizedScore?: number | null;
  estimatedLevel?: EnglishLevel | null;
  notes?: string | null;
  sections?: SectionScoreInput[] | null;
}

export interface MockListFilters {
  examType?: ExamType;
  mockType?: MockType;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// ── Safe (response) interfaces ─────────────────────────────────────────────────

export interface SafeSectionScore {
  id: string;
  sectionCode: string;
  sectionName: string;
  rawScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  standardizedScore: number | null;
  notes: string | null;
}

export interface SafeMock {
  id: string;
  name: string;
  examType: ExamType;
  mockType: MockType;
  takenAt: Date | null;
  estimatedStandardizedScore: number | null;
  scoreScale: string;
  estimatedLevel: EnglishLevel | null;
  notes: string | null;
  sections: SafeSectionScore[];
  createdAt: Date;
  updatedAt: Date;
}

// ── Export (CSV) row ────────────────────────────────────────────────────────────

export interface MockExportRow {
  mockId: string;
  mockName: string;
  examType: ExamType;
  mockType: MockType;
  takenAt: string;
  estimatedStandardizedScore: number | string;
  scoreScale: string;
  estimatedLevel: EnglishLevel | string;
  notes: string;
  sectionCode: string;
  sectionName: string;
  rawScore: number | string;
  maxScore: number | string;
  percentage: number | string;
  standardizedScore: number | string;
  sectionNotes: string;
}
