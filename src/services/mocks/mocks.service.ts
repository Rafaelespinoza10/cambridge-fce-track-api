import { getDatabaseConnection } from '../../lib/database';
import { fromCsv } from '../../lib/csv';
import { MocksRepository } from '../../repositories/mocks.repository';
import { ExamType, MockType, EnglishLevel } from '../../models/enums';
import type { ImportResult } from '../../lib/csv';
import type {
  CreateMockBody,
  UpdateMockBody,
  MockListFilters,
  MockExportRow,
  SafeMock,
  SectionScoreInput,
} from '../../interfaces/mocks/mocks.interface';
import {
  buildSectionData,
  createError,
  toMockExportRows,
  toSafeMock,
  VALID_EXAM_TYPES,
  VALID_LEVELS,
  VALID_MOCK_TYPES,
  validateSections,
} from '@lib/mocks-library';
import { findMockExamSectionByName, getMockExamCatalog } from '@lib/mock-exam-catalog';

class MocksService {
  getSectionCatalog(examType: ExamType) {
    if (!VALID_EXAM_TYPES.has(examType)) {
      throw createError(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
    }
    const catalog = getMockExamCatalog(examType);
    return {
      examType,
      scoreScale: catalog.scoreScale,
      sections: catalog.sections,
    };
  }

  async createMock(userId: string, body: CreateMockBody): Promise<SafeMock> {
    if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
      throw createError('name is required', 400);
    }

    const examType = (body.examType ?? ExamType.B2_FIRST) as ExamType;
    if (!VALID_EXAM_TYPES.has(examType)) {
      throw createError(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
    }

    const mockType = (body.mockType ?? MockType.FULL) as MockType;
    if (!VALID_MOCK_TYPES.has(mockType)) {
      throw createError(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
    }

    let takenAt: Date | null = null;
    if (body.takenAt !== undefined && body.takenAt !== null) {
      takenAt = new Date(body.takenAt);
      if (isNaN(takenAt.getTime())) throw createError('takenAt must be a valid ISO timestamp', 400);
    }

    if (
      body.estimatedLevel !== undefined &&
      body.estimatedLevel !== null &&
      !VALID_LEVELS.has(body.estimatedLevel)
    ) {
      throw createError(
        `estimatedLevel must be one of: ${Object.values(EnglishLevel).join(', ')}`,
        400,
      );
    }

    const sections = body.sections ?? [];
    validateSections(examType, mockType, sections);

    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const mock = await repo.createMock({
      userId,
      name: body.name.trim(),
      examType,
      mockType,
      takenAt,
      estimatedStandardizedScore: body.estimatedStandardizedScore ?? null,
      scoreScale: getMockExamCatalog(examType).scoreScale,
      estimatedLevel: body.estimatedLevel ?? null,
      notes: body.notes ?? null,
    });

    await repo.createSections(sections.map((s) => buildSectionData(mock.id, examType, s)));

    const full = await repo.findMockWithSections(mock.id);
    if (full === null) throw createError('Mock not found after creation', 500);

    return toSafeMock(full);
  }

  async getMock(userId: string, mockId: string): Promise<SafeMock> {
    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const mock = await repo.findMockWithOwner(mockId, userId);
    if (mock === null) throw createError('Mock not found', 404);

    return toSafeMock(mock);
  }

  async listMocks(
    userId: string,
    filters: MockListFilters,
  ): Promise<{ data: SafeMock[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;

    if (filters.examType !== undefined && !VALID_EXAM_TYPES.has(filters.examType)) {
      throw createError(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
    }
    if (filters.mockType !== undefined && !VALID_MOCK_TYPES.has(filters.mockType)) {
      throw createError(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (filters.from !== undefined) {
      fromDate = new Date(filters.from);
      if (isNaN(fromDate.getTime())) throw createError('from must be a valid date', 400);
    }
    if (filters.to !== undefined) {
      toDate = new Date(filters.to);
      if (isNaN(toDate.getTime())) throw createError('to must be a valid date', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const [mocks, total] = await repo.findMocks({
      userId,
      examType: filters.examType,
      mockType: filters.mockType,
      from: fromDate,
      to: toDate,
      limit,
      offset,
    });

    return { data: mocks.map(toSafeMock), total, limit, offset };
  }

  async exportMocks(
    userId: string,
    filters: Omit<MockListFilters, 'limit' | 'offset'>,
  ): Promise<MockExportRow[]> {
    if (filters.examType !== undefined && !VALID_EXAM_TYPES.has(filters.examType)) {
      throw createError(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
    }
    if (filters.mockType !== undefined && !VALID_MOCK_TYPES.has(filters.mockType)) {
      throw createError(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (filters.from !== undefined) {
      fromDate = new Date(filters.from);
      if (isNaN(fromDate.getTime())) throw createError('from must be a valid date', 400);
    }
    if (filters.to !== undefined) {
      toDate = new Date(filters.to);
      if (isNaN(toDate.getTime())) throw createError('to must be a valid date', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const mocks = await repo.findMocksForExport({
      userId,
      examType: filters.examType,
      mockType: filters.mockType,
      from: fromDate,
      to: toDate,
    });

    return mocks.flatMap(toMockExportRows);
  }

  async updateMock(userId: string, mockId: string, body: UpdateMockBody): Promise<SafeMock> {
    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const existing = await repo.findMockWithOwner(mockId, userId);
    if (existing === null) throw createError('Mock not found', 404);

    if (
      body.examType !== undefined &&
      body.examType !== null &&
      !VALID_EXAM_TYPES.has(body.examType)
    ) {
      throw createError(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
    }
    if (
      body.mockType !== undefined &&
      body.mockType !== null &&
      !VALID_MOCK_TYPES.has(body.mockType)
    ) {
      throw createError(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
    }
    if (
      body.estimatedLevel !== undefined &&
      body.estimatedLevel !== null &&
      !VALID_LEVELS.has(body.estimatedLevel)
    ) {
      throw createError(
        `estimatedLevel must be one of: ${Object.values(EnglishLevel).join(', ')}`,
        400,
      );
    }

    const updateData: Parameters<MocksRepository['updateMock']>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw createError('name must be a non-empty string', 400);
      }
      updateData.name = body.name.trim();
    }
    const nextExamType = body.examType ?? existing.exam_type;
    const nextMockType = body.mockType ?? existing.mock_type;
    const typeChanged = nextExamType !== existing.exam_type || nextMockType !== existing.mock_type;
    if (typeChanged && body.sections === undefined) {
      throw createError('sections are required when changing examType or mockType', 400);
    }

    if (body.examType !== undefined) {
      updateData.exam_type = body.examType ?? undefined;
      updateData.score_scale = getMockExamCatalog(nextExamType).scoreScale;
    }
    if (body.mockType !== undefined) updateData.mock_type = body.mockType ?? undefined;
    if (body.estimatedStandardizedScore !== undefined) {
      updateData.estimated_standardized_score = body.estimatedStandardizedScore;
    }
    if (body.estimatedLevel !== undefined) updateData.estimated_level = body.estimatedLevel;
    if (body.notes !== undefined) updateData.notes = body.notes;

    if (body.takenAt !== undefined) {
      if (body.takenAt === null) {
        updateData.taken_at = null;
      } else {
        const parsed = new Date(body.takenAt);
        if (isNaN(parsed.getTime()))
          throw createError('takenAt must be a valid ISO timestamp', 400);
        updateData.taken_at = parsed;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await repo.updateMock(mockId, updateData);
    }

    if (body.sections !== undefined && body.sections !== null) {
      validateSections(nextExamType, nextMockType, body.sections);
      await repo.replaceSections(
        mockId,
        body.sections.map((s) => buildSectionData(mockId, nextExamType, s)),
      );
    }

    const updated = await repo.findMockWithSections(mockId);
    if (updated === null) throw createError('Mock not found', 500);

    return toSafeMock(updated);
  }

  async deleteMock(userId: string, mockId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const existing = await repo.findMockWithOwner(mockId, userId);
    if (existing === null) throw createError('Mock not found', 404);

    await repo.softDeleteMock(mockId);
  }

  async importMocks(userId: string, csvText: string): Promise<ImportResult> {
    let rows: Record<string, string>[];
    try {
      rows = fromCsv(csvText);
    } catch {
      throw createError('Invalid CSV content', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    const groups = new Map<string, { firstRow: number; rows: Record<string, string>[] }>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const mockName = (row['Mock Name'] ?? '').trim();
      if (mockName === '') {
        result.errors.push({ row: rowNum, reason: 'Mock Name is required' });
        continue;
      }
      const key = `${mockName.toLowerCase()}__${(row['Taken At'] ?? '').trim()}`;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, { firstRow: rowNum, rows: [row] });
      } else {
        group.rows.push(row);
      }
    }

    for (const [, group] of groups) {
      try {
        const first = group.rows[0];
        const mockName = (first['Mock Name'] ?? '').trim();

        const examTypeRaw = (first['Exam Type'] ?? '').trim();
        const examType = (examTypeRaw !== '' ? examTypeRaw : ExamType.B2_FIRST) as ExamType;
        if (!VALID_EXAM_TYPES.has(examType)) {
          throw new Error(`Invalid Exam Type "${examTypeRaw}"`);
        }

        const mockTypeRaw = (first['Mock Type'] ?? '').trim();
        const mockType = (mockTypeRaw !== '' ? mockTypeRaw : MockType.FULL) as MockType;
        if (!VALID_MOCK_TYPES.has(mockType)) {
          throw new Error(`Invalid Mock Type "${mockTypeRaw}"`);
        }

        const takenAtRaw = (first['Taken At'] ?? '').trim();
        let takenAt: Date | null = null;
        if (takenAtRaw !== '') {
          takenAt = new Date(takenAtRaw);
          if (isNaN(takenAt.getTime())) throw new Error('Taken At must be a valid date');
        }

        const duplicate = await repo.findMockByNameAndTakenAt(userId, mockName, takenAt);
        if (duplicate !== null) {
          result.skipped++;
          continue;
        }

        const estimatedScoreRaw = (
          first['Estimated Standardized Score'] ??
          first['Estimated Cambridge Score'] ??
          ''
        ).trim();
        const estimatedStandardizedScore =
          estimatedScoreRaw !== '' ? Number(estimatedScoreRaw) : null;
        if (
          estimatedScoreRaw !== '' &&
          (estimatedStandardizedScore === null || isNaN(estimatedStandardizedScore))
        ) {
          throw new Error('Estimated Standardized Score must be a number');
        }

        const estimatedLevelRaw = (first['Estimated Level'] ?? '').trim();
        if (estimatedLevelRaw !== '' && !VALID_LEVELS.has(estimatedLevelRaw)) {
          throw new Error(`Invalid Estimated Level "${estimatedLevelRaw}"`);
        }
        const estimatedLevel =
          estimatedLevelRaw !== '' ? (estimatedLevelRaw as EnglishLevel) : null;

        const notes = (first['Notes'] ?? '').trim() || null;

        const sections: SectionScoreInput[] = [];
        for (const data of group.rows) {
          const sectionName = (data['Section'] ?? '').trim();
          const sectionCodeRaw = (data['Section Code'] ?? '').trim();
          if (sectionName === '' && sectionCodeRaw === '') continue;
          const catalogSection =
            sectionCodeRaw !== ''
              ? getMockExamCatalog(examType).sections.find(
                  (section) => section.code === sectionCodeRaw,
                )
              : findMockExamSectionByName(examType, sectionName);
          if (catalogSection === undefined)
            throw new Error(`Unknown section "${sectionCodeRaw || sectionName}" for ${examType}`);
          const sectionCode = catalogSection.code;

          const rawScoreRaw = (data['Raw Score'] ?? '').trim();
          if (rawScoreRaw === '') throw new Error(`Section "${sectionCode}" is missing Raw Score`);
          const rawScore = Number(rawScoreRaw);
          if (isNaN(rawScore))
            throw new Error(`Section "${sectionCode}" Raw Score must be a number`);

          const maxScoreRaw = (data['Max Score'] ?? '').trim();
          const maxScore = maxScoreRaw !== '' ? Number(maxScoreRaw) : null;
          if (maxScoreRaw !== '' && (maxScore === null || isNaN(maxScore))) {
            throw new Error(`Section "${sectionCode}" Max Score must be a number`);
          }

          const standardizedScoreRaw = (
            data['Section Standardized Score'] ??
            data['Section Cambridge Score'] ??
            ''
          ).trim();
          const standardizedScore =
            standardizedScoreRaw !== '' ? Number(standardizedScoreRaw) : null;
          if (
            standardizedScoreRaw !== '' &&
            (standardizedScore === null || isNaN(standardizedScore))
          ) {
            throw new Error(`Section "${sectionCode}" Standardized Score must be a number`);
          }

          const sectionNotes = (data['Section Notes'] ?? '').trim() || null;

          sections.push({
            sectionCode,
            rawScore,
            maxScore,
            standardizedScore,
            notes: sectionNotes,
          });
        }

        validateSections(examType, mockType, sections);

        const mock = await repo.createMock({
          userId,
          name: mockName,
          examType,
          mockType,
          takenAt,
          estimatedStandardizedScore,
          scoreScale: getMockExamCatalog(examType).scoreScale,
          estimatedLevel,
          notes,
        });

        await repo.createSections(sections.map((s) => buildSectionData(mock.id, examType, s)));

        result.imported++;
      } catch (err) {
        result.errors.push({
          row: group.firstRow,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return result;
  }
}

export { MocksService };
