import type { DataSource, Repository } from 'typeorm';
import { EvidenceFile } from '@models/EvidenceFile';
import type { StorageProvider } from '@models/enums';

interface CreateEvidenceData {
  userId: string;
  fileName: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storageProvider: StorageProvider;
  storageKey: string;
  publicUrl: string | null;
  uploadedAt: Date;
  plannedActivityId: string | null;
  activityScoreId: string | null;
  mockTestId: string | null;
}

interface EvidenceListOptions {
  userId: string;
  plannedActivityId?: string;
  activityScoreId?: string;
  mockTestId?: string;
  limit: number;
  offset: number;
}

class EvidenceRepository {
  private readonly repo: Repository<EvidenceFile>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(EvidenceFile);
  }

  async create(data: CreateEvidenceData): Promise<EvidenceFile> {
    const entity = this.repo.create({
      user_id: data.userId,
      file_name: data.fileName,
      original_file_name: data.originalFileName,
      mime_type: data.mimeType,
      file_size: data.fileSize,
      storage_provider: data.storageProvider,
      storage_key: data.storageKey,
      public_url: data.publicUrl,
      uploaded_at: data.uploadedAt,
      planned_activity_id: data.plannedActivityId,
      activity_score_id: data.activityScoreId,
      mock_test_id: data.mockTestId,
    });
    return this.repo.save(entity);
  }

  async findByIdAndOwner(evidenceId: string, userId: string): Promise<EvidenceFile | null> {
    return this.repo
      .createQueryBuilder('ef')
      .where('ef.id = :evidenceId', { evidenceId })
      .andWhere('ef.user_id = :userId', { userId })
      .andWhere('ef.deleted_at IS NULL')
      .getOne();
  }

  async findMany(options: EvidenceListOptions): Promise<[EvidenceFile[], number]> {
    const qb = this.repo
      .createQueryBuilder('ef')
      .leftJoinAndSelect('ef.planned_activity', 'planned_activity')
      .leftJoinAndSelect('ef.activity_score', 'activity_score')
      .leftJoinAndSelect('activity_score.planned_activity', 'score_planned_activity')
      .leftJoinAndSelect('activity_score.skill', 'score_skill')
      .leftJoinAndSelect('ef.mock_test', 'mock_test')
      .where('ef.user_id = :userId', { userId: options.userId })
      .andWhere('ef.deleted_at IS NULL');

    if (options.plannedActivityId !== undefined) {
      qb.andWhere('ef.planned_activity_id = :id', { id: options.plannedActivityId });
    }
    if (options.activityScoreId !== undefined) {
      qb.andWhere('ef.activity_score_id = :id', { id: options.activityScoreId });
    }
    if (options.mockTestId !== undefined) {
      qb.andWhere('ef.mock_test_id = :id', { id: options.mockTestId });
    }

    qb.orderBy('ef.uploaded_at', 'DESC').skip(options.offset).take(options.limit);

    return qb.getManyAndCount();
  }

  async softDelete(evidenceId: string): Promise<void> {
    await this.repo.softDelete({ id: evidenceId });
  }
}

export { EvidenceRepository };
export type { CreateEvidenceData, EvidenceListOptions };
