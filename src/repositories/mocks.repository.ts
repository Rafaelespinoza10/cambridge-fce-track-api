import type { DataSource, Repository } from 'typeorm';
import { MockTest } from '../models/MockTest';
import { MockSectionScore } from '../models/MockSectionScore';
import type { ExamType, MockType, EnglishLevel } from '../models/enums';

interface CreateMockData {
  userId: string;
  name: string;
  examType: ExamType;
  mockType: MockType;
  takenAt: Date | null;
  estimatedCambridgeScore: number | null;
  estimatedLevel: EnglishLevel | null;
  notes: string | null;
}

interface CreateSectionData {
  mockTestId: string;
  sectionName: string;
  rawScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  cambridgeScore: number | null;
  notes: string | null;
}

interface UpdateMockData {
  name?: string;
  exam_type?: ExamType;
  mock_type?: MockType;
  taken_at?: Date | null;
  estimated_cambridge_score?: number | null;
  estimated_level?: EnglishLevel | null;
  notes?: string | null;
}

interface MockListOptions {
  userId: string;
  examType?: ExamType;
  mockType?: MockType;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

interface MockExportOptions {
  userId: string;
  examType?: ExamType;
  mockType?: MockType;
  from?: Date;
  to?: Date;
}

class MocksRepository {
  private readonly mockRepo: Repository<MockTest>;
  private readonly sectionRepo: Repository<MockSectionScore>;
  private readonly dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.mockRepo = dataSource.getRepository(MockTest);
    this.sectionRepo = dataSource.getRepository(MockSectionScore);
  }

  async createMock(data: CreateMockData): Promise<MockTest> {
    const entity = this.mockRepo.create({
      user_id: data.userId,
      name: data.name,
      exam_type: data.examType,
      mock_type: data.mockType,
      taken_at: data.takenAt,
      estimated_cambridge_score: data.estimatedCambridgeScore,
      estimated_level: data.estimatedLevel,
      notes: data.notes,
    });
    return this.mockRepo.save(entity);
  }

  async createSections(sections: CreateSectionData[]): Promise<MockSectionScore[]> {
    const built = sections.map((s) =>
      this.sectionRepo.create({
        mock_test_id: s.mockTestId,
        section_name: s.sectionName,
        raw_score: s.rawScore !== null ? String(s.rawScore) : null,
        max_score: s.maxScore !== null ? String(s.maxScore) : null,
        percentage: s.percentage !== null ? String(s.percentage) : null,
        cambridge_score: s.cambridgeScore,
        notes: s.notes,
      }),
    );
    return this.sectionRepo.save(built);
  }

  async findMockWithSections(mockId: string): Promise<MockTest | null> {
    return this.mockRepo
      .createQueryBuilder('mock')
      .leftJoinAndSelect('mock.section_scores', 'ss')
      .where('mock.id = :mockId', { mockId })
      .andWhere('mock.deleted_at IS NULL')
      .orderBy('ss.section_name', 'ASC')
      .getOne();
  }

  async findMockWithOwner(mockId: string, userId: string): Promise<MockTest | null> {
    return this.mockRepo
      .createQueryBuilder('mock')
      .leftJoinAndSelect('mock.section_scores', 'ss')
      .where('mock.id = :mockId', { mockId })
      .andWhere('mock.user_id = :userId', { userId })
      .andWhere('mock.deleted_at IS NULL')
      .orderBy('ss.section_name', 'ASC')
      .getOne();
  }

  async findMocks(options: MockListOptions): Promise<[MockTest[], number]> {
    const qb = this.mockRepo
      .createQueryBuilder('mock')
      .leftJoinAndSelect('mock.section_scores', 'ss')
      .where('mock.user_id = :userId', { userId: options.userId })
      .andWhere('mock.deleted_at IS NULL');

    if (options.examType !== undefined) {
      qb.andWhere('mock.exam_type = :examType', { examType: options.examType });
    }
    if (options.mockType !== undefined) {
      qb.andWhere('mock.mock_type = :mockType', { mockType: options.mockType });
    }
    if (options.from !== undefined) {
      qb.andWhere('mock.taken_at >= :from', { from: options.from });
    }
    if (options.to !== undefined) {
      qb.andWhere('mock.taken_at <= :to', { to: options.to });
    }

    qb.orderBy('mock.taken_at', 'DESC', 'NULLS LAST')
      .addOrderBy('mock.created_at', 'DESC')
      .skip(options.offset)
      .take(options.limit);

    return qb.getManyAndCount();
  }

  async findMocksForExport(options: MockExportOptions): Promise<MockTest[]> {
    const qb = this.mockRepo
      .createQueryBuilder('mock')
      .leftJoinAndSelect('mock.section_scores', 'ss')
      .where('mock.user_id = :userId', { userId: options.userId })
      .andWhere('mock.deleted_at IS NULL');

    if (options.examType !== undefined) {
      qb.andWhere('mock.exam_type = :examType', { examType: options.examType });
    }
    if (options.mockType !== undefined) {
      qb.andWhere('mock.mock_type = :mockType', { mockType: options.mockType });
    }
    if (options.from !== undefined) {
      qb.andWhere('mock.taken_at >= :from', { from: options.from });
    }
    if (options.to !== undefined) {
      qb.andWhere('mock.taken_at <= :to', { to: options.to });
    }

    qb.orderBy('mock.taken_at', 'DESC', 'NULLS LAST')
      .addOrderBy('mock.created_at', 'DESC')
      .addOrderBy('ss.section_name', 'ASC');

    return qb.getMany();
  }

  async findMockByNameAndTakenAt(
    userId: string,
    name: string,
    takenAt: Date | null,
  ): Promise<MockTest | null> {
    const qb = this.mockRepo
      .createQueryBuilder('mock')
      .where('mock.user_id = :userId', { userId })
      .andWhere('LOWER(mock.name) = LOWER(:name)', { name })
      .andWhere('mock.deleted_at IS NULL');

    if (takenAt === null) {
      qb.andWhere('mock.taken_at IS NULL');
    } else {
      qb.andWhere('mock.taken_at = :takenAt', { takenAt });
    }

    return qb.getOne();
  }

  async updateMock(mockId: string, data: UpdateMockData): Promise<void> {
    await this.mockRepo.update({ id: mockId }, data);
  }

  async replaceSections(
    mockId: string,
    sections: CreateSectionData[],
  ): Promise<MockSectionScore[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(MockSectionScore, { mock_test_id: mockId });
      if (sections.length === 0) return [];
      const built = sections.map((s) =>
        manager.create(MockSectionScore, {
          mock_test_id: s.mockTestId,
          section_name: s.sectionName,
          raw_score: s.rawScore !== null ? String(s.rawScore) : null,
          max_score: s.maxScore !== null ? String(s.maxScore) : null,
          percentage: s.percentage !== null ? String(s.percentage) : null,
          cambridge_score: s.cambridgeScore,
          notes: s.notes,
        }),
      );
      return manager.save(MockSectionScore, built);
    });
  }

  async softDeleteMock(mockId: string): Promise<void> {
    await this.mockRepo.softDelete({ id: mockId });
  }
}

export { MocksRepository };
export type { CreateMockData, CreateSectionData, UpdateMockData, MockListOptions, MockExportOptions };
