import { EnglishLevel, ExamType, MockType } from '@models/enums';
import { MockSectionScore } from '@models/MockSectionScore';
import { MockTest } from '@models/MockTest';
import type { MockExportRow, SafeMock, SafeSectionScore, SectionScoreInput } from 'src/interfaces';
import { MocksRepository } from '@repositories/mocks/mocks.repository';
import { getMockExamCatalog, getMockExamSection } from './mock-exam-catalog';

export function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function parseNumeric(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function toSafeSection(s: MockSectionScore, examType: ExamType): SafeSectionScore {
  const catalogSection = getMockExamSection(examType, s.section_code);
  return {
    id: s.id,
    sectionCode: s.section_code,
    sectionName: catalogSection?.name ?? s.section_code,
    rawScore: parseNumeric(s.raw_score),
    maxScore: parseNumeric(s.max_score),
    percentage: parseNumeric(s.percentage),
    standardizedScore: parseNumeric(s.standardized_score),
    notes: s.notes,
  };
}

export function toSafeMock(mock: MockTest): SafeMock {
  return {
    id: mock.id,
    name: mock.name,
    examType: mock.exam_type,
    mockType: mock.mock_type,
    takenAt: mock.taken_at,
    estimatedStandardizedScore: parseNumeric(mock.estimated_standardized_score),
    scoreScale: mock.score_scale,
    estimatedLevel: mock.estimated_level,
    notes: mock.notes,
    sections: (mock.section_scores ?? []).map((section) => toSafeSection(section, mock.exam_type)),
    createdAt: mock.created_at,
    updatedAt: mock.updated_at,
  };
}

export function toMockExportRows(mock: MockTest): MockExportRow[] {
  const base = {
    mockId: mock.id,
    mockName: mock.name,
    examType: mock.exam_type,
    mockType: mock.mock_type,
    takenAt: mock.taken_at?.toISOString() ?? '',
    estimatedStandardizedScore: parseNumeric(mock.estimated_standardized_score) ?? '',
    scoreScale: mock.score_scale,
    estimatedLevel: mock.estimated_level ?? '',
    notes: mock.notes ?? '',
  };
  const sections = mock.section_scores ?? [];
  if (sections.length === 0) {
    return [{ ...base, sectionCode: '', sectionName: '', rawScore: '', maxScore: '', percentage: '', standardizedScore: '', sectionNotes: '' }];
  }
  return sections.map((section) => ({
    ...base,
    sectionCode: section.section_code,
    sectionName: getMockExamSection(mock.exam_type, section.section_code)?.name ?? section.section_code,
    rawScore: parseNumeric(section.raw_score) ?? '',
    maxScore: parseNumeric(section.max_score) ?? '',
    percentage: parseNumeric(section.percentage) ?? '',
    standardizedScore: parseNumeric(section.standardized_score) ?? '',
    sectionNotes: section.notes ?? '',
  }));
}

export const VALID_EXAM_TYPES = new Set<string>(Object.values(ExamType));
export const VALID_MOCK_TYPES = new Set<string>(Object.values(MockType));
export const VALID_LEVELS = new Set<string>(Object.values(EnglishLevel));

export function buildSectionData(
  mockTestId: string,
  examType: ExamType,
  input: SectionScoreInput,
): Parameters<MocksRepository['createSections']>[0][number] {
  const catalogSection = getMockExamSection(examType, input.sectionCode);
  if (catalogSection === undefined) throw createError(`Unknown sectionCode "${input.sectionCode}"`, 400);
  const maxScore = input.maxScore ?? catalogSection.defaultMaxScore;
  const percentage = maxScore !== null && maxScore > 0 ? roundTwo((input.rawScore / maxScore) * 100) : null;
  return {
    mockTestId,
    sectionCode: input.sectionCode,
    rawScore: input.rawScore,
    maxScore,
    percentage,
    standardizedScore: input.standardizedScore ?? null,
    notes: input.notes ?? null,
  };
}

export function validateSections(examType: ExamType, mockType: MockType, sections: SectionScoreInput[]): void {
  const catalog = getMockExamCatalog(examType);
  const expectedCodes = catalog.sections.map((section) => section.code);
  const selected = sections.map((section) => section.sectionCode);
  if (new Set(selected).size !== selected.length) throw createError('Each section may be selected only once', 400);
  if (selected.some((code) => !expectedCodes.includes(code))) throw createError('A selected section does not belong to this exam', 400);
  if (mockType === MockType.FULL && (selected.length !== expectedCodes.length || expectedCodes.some((code) => !selected.includes(code)))) {
    throw createError('A full mock must include every section of its exam', 400);
  }
  if (mockType === MockType.PARTIAL && selected.length === 0) throw createError('A partial mock must include at least one section', 400);
  for (const section of sections) {
    if (typeof section.rawScore !== 'number' || section.rawScore < 0) throw createError(`Section "${section.sectionCode}": rawScore must be a non-negative number`, 400);
    const defaultMax = getMockExamSection(examType, section.sectionCode)?.defaultMaxScore ?? null;
    const maxScore = section.maxScore ?? defaultMax;
    if (maxScore !== null && section.rawScore > maxScore) throw createError(`Section "${section.sectionCode}": rawScore exceeds maxScore`, 400);
  }
}
