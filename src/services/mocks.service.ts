import { getDatabaseConnection } from '../lib/database';
import { MocksRepository } from '../repositories/mocks.repository';
import { ExamType, MockType, EnglishLevel } from '../models/enums';
import type {
  CreateMockBody,
  UpdateMockBody,
  MockListFilters,
  SafeMock,
} from '../interfaces/mocks.interface';
import { buildSectionData, createError, toSafeMock, VALID_EXAM_TYPES, VALID_LEVELS, VALID_MOCK_TYPES, validateSections } from '@lib/mocks-library';



class MocksService {
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
      throw createError(`estimatedLevel must be one of: ${Object.values(EnglishLevel).join(', ')}`, 400);
    }

    const sections = body.sections ?? [];
    if (sections.length > 0) validateSections(sections);

    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const mock = await repo.createMock({
      userId,
      name: body.name.trim(),
      examType,
      mockType,
      takenAt,
      estimatedCambridgeScore: body.estimatedCambridgeScore ?? null,
      estimatedLevel: body.estimatedLevel ?? null,
      notes: body.notes ?? null,
    });

    if (sections.length > 0) {
      await repo.createSections(sections.map((s) => buildSectionData(mock.id, s)));
    }

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

  async updateMock(userId: string, mockId: string, body: UpdateMockBody): Promise<SafeMock> {
    const ds = await getDatabaseConnection();
    const repo = new MocksRepository(ds);

    const existing = await repo.findMockWithOwner(mockId, userId);
    if (existing === null) throw createError('Mock not found', 404);

    if (body.examType !== undefined && body.examType !== null && !VALID_EXAM_TYPES.has(body.examType)) {
      throw createError(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
    }
    if (body.mockType !== undefined && body.mockType !== null && !VALID_MOCK_TYPES.has(body.mockType)) {
      throw createError(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
    }
    if (
      body.estimatedLevel !== undefined &&
      body.estimatedLevel !== null &&
      !VALID_LEVELS.has(body.estimatedLevel)
    ) {
      throw createError(`estimatedLevel must be one of: ${Object.values(EnglishLevel).join(', ')}`, 400);
    }

    const updateData: Parameters<MocksRepository['updateMock']>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw createError('name must be a non-empty string', 400);
      }
      updateData.name = body.name.trim();
    }
    if (body.examType !== undefined) updateData.exam_type = body.examType ?? undefined;
    if (body.mockType !== undefined) updateData.mock_type = body.mockType ?? undefined;
    if (body.estimatedCambridgeScore !== undefined) {
      updateData.estimated_cambridge_score = body.estimatedCambridgeScore;
    }
    if (body.estimatedLevel !== undefined) updateData.estimated_level = body.estimatedLevel;
    if (body.notes !== undefined) updateData.notes = body.notes;

    if (body.takenAt !== undefined) {
      if (body.takenAt === null) {
        updateData.taken_at = null;
      } else {
        const parsed = new Date(body.takenAt);
        if (isNaN(parsed.getTime())) throw createError('takenAt must be a valid ISO timestamp', 400);
        updateData.taken_at = parsed;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await repo.updateMock(mockId, updateData);
    }

    if (body.sections !== undefined && body.sections !== null) {
      validateSections(body.sections);
      await repo.replaceSections(
        mockId,
        body.sections.map((s) => buildSectionData(mockId, s)),
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
}

export { MocksService };
