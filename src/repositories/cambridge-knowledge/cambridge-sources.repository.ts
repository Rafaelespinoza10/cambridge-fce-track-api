import type { DataSource, EntityManager, Repository } from 'typeorm';
import { CambridgeSource } from '@models/CambridgeSource';
import type { CambridgeSourceStatus } from '@models/enums';

export interface CreateSourceData {
  name: string;
  description: string | null;
  version: string;
  checksum: string;
  pageCount: number;
}

export interface CambridgeSourceDto {
  id: string;
  name: string;
  description: string | null;
  version: string;
  status: CambridgeSourceStatus;
  pageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toSourceDto(source: CambridgeSource): CambridgeSourceDto {
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    version: source.version,
    status: source.status,
    pageCount: source.page_count,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  };
}

class CambridgeSourcesRepository {
  private readonly sourceRepo: Repository<CambridgeSource>;

  constructor(dataSource: DataSource | EntityManager) {
    this.sourceRepo = dataSource.getRepository(CambridgeSource);
  }

  /** Checksum is UNIQUE at the DB level — this is the pre-check ImportCambridgeKnowledgeService uses to short-circuit before doing any (expensive) extraction/classification/embedding work. */
  async findByChecksum(checksum: string): Promise<CambridgeSource | null> {
    return this.sourceRepo.findOne({ where: { checksum } });
  }

  async createSource(data: CreateSourceData): Promise<CambridgeSource> {
    const source = this.sourceRepo.create({
      name: data.name,
      description: data.description,
      version: data.version,
      checksum: data.checksum,
      page_count: data.pageCount,
    });
    return this.sourceRepo.save(source);
  }

  async listSources(): Promise<CambridgeSourceDto[]> {
    const sources = await this.sourceRepo
      .createQueryBuilder('source')
      .orderBy('source.created_at', 'DESC')
      .getMany();
    return sources.map(toSourceDto);
  }
}

export { CambridgeSourcesRepository, toSourceDto };
