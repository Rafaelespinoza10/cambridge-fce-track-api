import type { ExamType, MockType, EnglishLevel } from '../models/enums';

// ── Section score maximums per spec section 8 ──────────────────────────────────

export const SECTION_MAX_SCORES: Readonly<Record<string, number>> = {
  Reading: 30,
  'Use of English': 28,
  Writing: 40,
  Listening: 30,
  Speaking: 40,
};

// ── Input interfaces ───────────────────────────────────────────────────────────

export interface SectionScoreInput {
  sectionName: string;
  rawScore: number;
  maxScore?: number | null;
  cambridgeScore?: number | null;
  notes?: string | null;
}

export interface CreateMockBody {
  name: string;
  examType?: ExamType | null;
  mockType?: MockType | null;
  takenAt?: string | null;
  estimatedCambridgeScore?: number | null;
  estimatedLevel?: EnglishLevel | null;
  notes?: string | null;
  sections?: SectionScoreInput[] | null;
}

export interface UpdateMockBody {
  name?: string;
  examType?: ExamType | null;
  mockType?: MockType | null;
  takenAt?: string | null;
  estimatedCambridgeScore?: number | null;
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
  sectionName: string;
  rawScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  cambridgeScore: number | null;
  notes: string | null;
}

export interface SafeMock {
  id: string;
  name: string;
  examType: ExamType;
  mockType: MockType;
  takenAt: Date | null;
  estimatedCambridgeScore: number | null;
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
  estimatedCambridgeScore: number | string;
  estimatedLevel: EnglishLevel | string;
  notes: string;
  sectionName: string;
  rawScore: number | string;
  maxScore: number | string;
  percentage: number | string;
  cambridgeScore: number | string;
  sectionNotes: string;
}
