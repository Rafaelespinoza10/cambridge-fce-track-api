import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { Resource } from '@models/Resource';
import { ResourceType } from '@models/enums';

interface CreateResourceData {
  userId: string;
  title: string;
  description: string | null;
  url: string;
}

class ResourcesRepository {
  private readonly repo: Repository<Resource>;

  constructor(source: DataSource | EntityManager) {
    this.repo = source.getRepository(Resource);
  }

  async findGlobalLinks(): Promise<Resource[]> {
    return this.repo
      .createQueryBuilder('resource')
      .where('resource.is_global = true')
      .andWhere('resource.resource_type = :type', { type: ResourceType.LINK })
      .andWhere('resource.deleted_at IS NULL')
      .orderBy('resource.title', 'ASC')
      .getMany();
  }

  async findByUserId(userId: string): Promise<Resource[]> {
    return this.repo
      .createQueryBuilder('resource')
      .where('resource.user_id = :userId', { userId })
      .andWhere('resource.resource_type = :type', { type: ResourceType.LINK })
      .andWhere('resource.deleted_at IS NULL')
      .orderBy('resource.created_at', 'DESC')
      .getMany();
  }

  async create(data: CreateResourceData): Promise<Resource> {
    const resource = this.repo.create({
      user_id: data.userId,
      title: data.title,
      description: data.description,
      resource_type: ResourceType.LINK,
      url: data.url,
      storage_key: null,
      is_global: false,
    });
    return this.repo.save(resource);
  }

  async findActiveById(resourceId: string): Promise<Resource | null> {
    return this.repo
      .createQueryBuilder('resource')
      .where('resource.id = :resourceId', { resourceId })
      .andWhere('resource.deleted_at IS NULL')
      .getOne();
  }

  async softDelete(resourceId: string, userId: string): Promise<UpdateResult> {
    return this.repo.softDelete({ id: resourceId, user_id: userId });
  }
}

export { ResourcesRepository };
export type { CreateResourceData };
