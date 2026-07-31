
import { EnglishLevel, ExamType, MockType } from "@models/enums";
import { MockSectionScore } from "@models/MockSectionScore";
import { MockTest } from "@models/MockTest";
import { MockExportRow, SafeMock, SafeSectionScore, SECTION_MAX_SCORES, SectionScoreInput } from "src/interfaces";
import { MocksRepository } from "src/repositories/mocks.repository";

export function createError(message: string, statusCode: number): Error {
    return Object.assign(new Error(message), { statusCode });
}
  
  function parseNumeric(value: string | null): number | null {
    if (value === null) return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  
  function roundTwo(value: number): number {
    return Math.round(value * 100) / 100;
  }
  
  
  function toSafeSection(s: MockSectionScore): SafeSectionScore {
    return {
      id: s.id,
      sectionName: s.section_name,
      rawScore: parseNumeric(s.raw_score),
      maxScore: parseNumeric(s.max_score),
      percentage: parseNumeric(s.percentage),
      cambridgeScore: s.cambridge_score,
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
      estimatedCambridgeScore: mock.estimated_cambridge_score,
      estimatedLevel: mock.estimated_level,
      notes: mock.notes,
      sections: (mock.section_scores ?? []).map(toSafeSection),
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
      estimatedCambridgeScore: mock.estimated_cambridge_score ?? '',
      estimatedLevel: mock.estimated_level ?? '',
      notes: mock.notes ?? '',
    };

    const sections = mock.section_scores ?? [];
    if (sections.length === 0) {
      return [
        { ...base, sectionName: '', rawScore: '', maxScore: '', percentage: '', cambridgeScore: '', sectionNotes: '' },
      ];
    }

    return sections.map((s) => ({
      ...base,
      sectionName: s.section_name,
      rawScore: parseNumeric(s.raw_score) ?? '',
      maxScore: parseNumeric(s.max_score) ?? '',
      percentage: parseNumeric(s.percentage) ?? '',
      cambridgeScore: s.cambridge_score ?? '',
      sectionNotes: s.notes ?? '',
    }));
  }

  export const VALID_EXAM_TYPES = new Set<string>(Object.values(ExamType));
  export const VALID_MOCK_TYPES = new Set<string>(Object.values(MockType));
  export const VALID_LEVELS = new Set<string>(Object.values(EnglishLevel));
  
  export function buildSectionData(
    mockTestId: string,
    input: SectionScoreInput,
  ): Parameters<MocksRepository['createSections']>[0][number] {
    const rawScore = input.rawScore;
    const maxScore = input.maxScore ?? SECTION_MAX_SCORES[input.sectionName] ?? null;
    const percentage =
      maxScore !== null && maxScore > 0 ? roundTwo((rawScore / maxScore) * 100) : null;
  
    return {
      mockTestId,
      sectionName: input.sectionName,
      rawScore,
      maxScore,
      percentage,
      cambridgeScore: input.cambridgeScore ?? null,
      notes: input.notes ?? null,
    };
  }
  
 export function validateSections(sections: SectionScoreInput[]): void {
    for (const s of sections) {
      if (!s.sectionName || typeof s.sectionName !== 'string') {
        throw createError('Each section must have a sectionName', 400);
      }
      if (typeof s.rawScore !== 'number' || s.rawScore < 0) {
        throw createError(`Section "${s.sectionName}": rawScore must be a non-negative number`, 400);
      }
      const knownMax = SECTION_MAX_SCORES[s.sectionName];
      const effectiveMax = s.maxScore ?? knownMax ?? null;
      if (effectiveMax !== null && s.rawScore > effectiveMax) {
        throw createError(
          `Section "${s.sectionName}": rawScore (${s.rawScore}) exceeds maxScore (${effectiveMax})`,
          400,
        );
      }
    }
  }
  