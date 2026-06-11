import type { DataSource } from 'typeorm';
import { Recommendation } from '../models/Recommendation';
import { ActivityScore } from '../models/ActivityScore';
import { RecommendationStatus } from '../models/enums';

interface SkillAverage {
  skillId: string;
  skillName: string;
  avgScore: number;
}

interface CreateRecommendationData {
  userId: string;
  skillId: string;
  title: string;
  description: string;
  recommendationType: string;
  priority: string;
  source: string;
}

class RecommendationsRepository {
  constructor(private readonly ds: DataSource) {}

  async findByUser(
    userId: string,
    filters: { status?: string; type?: string; limit: number; offset: number },
  ): Promise<[Recommendation[], number]> {
    const qb = this.ds
      .createQueryBuilder(Recommendation, 'r')
      .leftJoinAndSelect('r.skill', 'sk')
      .where('r.user_id = :userId', { userId })
      .andWhere('r.deleted_at IS NULL')
      .orderBy('r.created_at', 'DESC');

    if (filters.status !== undefined) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }
    if (filters.type !== undefined) {
      qb.andWhere('r.recommendation_type = :type', { type: filters.type });
    }

    return qb.skip(filters.offset).take(filters.limit).getManyAndCount();
  }

  async findById(id: string): Promise<Recommendation | null> {
    return this.ds
      .createQueryBuilder(Recommendation, 'r')
      .leftJoinAndSelect('r.skill', 'sk')
      .where('r.id = :id', { id })
      .andWhere('r.deleted_at IS NULL')
      .getOne();
  }

  async findPendingForSkill(userId: string, skillId: string): Promise<Recommendation | null> {
    return this.ds
      .createQueryBuilder(Recommendation, 'r')
      .where('r.user_id = :userId', { userId })
      .andWhere('r.skill_id = :skillId', { skillId })
      .andWhere('r.status = :status', { status: RecommendationStatus.PENDING })
      .andWhere('r.deleted_at IS NULL')
      .getOne();
  }

  async create(data: CreateRecommendationData): Promise<Recommendation> {
    const repo = this.ds.getRepository(Recommendation);
    const rec = repo.create({
      user_id: data.userId,
      skill_id: data.skillId,
      title: data.title,
      description: data.description,
      recommendation_type: data.recommendationType as Recommendation['recommendation_type'],
      priority: data.priority as Recommendation['priority'],
      status: RecommendationStatus.PENDING,
      source: data.source as Recommendation['source'],
    });
    return repo.save(rec);
  }

  async updateFields(
    id: string,
    fields: Partial<Pick<Recommendation, 'title' | 'description' | 'recommendation_type' | 'priority' | 'status'>>,
  ): Promise<void> {
    await this.ds.getRepository(Recommendation).update({ id }, fields);
  }

  async softDelete(id: string): Promise<void> {
    await this.ds.getRepository(Recommendation).softDelete({ id });
  }

  async getSkillAverages(userId: string, since: Date): Promise<SkillAverage[]> {
    const rows = await this.ds
      .createQueryBuilder(ActivityScore, 'sc')
      .innerJoin('sc.skill', 'sk')
      .select('sk.id', 'skillId')
      .addSelect('sk.name', 'skillName')
      .addSelect('AVG(CAST(sc.percentage AS FLOAT))', 'avgScore')
      .where('sc.user_id = :userId', { userId })
      .andWhere('sc.deleted_at IS NULL')
      .andWhere('sc.percentage IS NOT NULL')
      .andWhere('sc.attempted_at >= :since', { since })
      .groupBy('sk.id')
      .addGroupBy('sk.name')
      .getRawMany<{ skillId: string; skillName: string; avgScore: string }>();

    return rows.map((r) => ({
      skillId: r.skillId,
      skillName: r.skillName,
      avgScore: parseFloat(r.avgScore) || 0,
    }));
  }
}

export { RecommendationsRepository };
export type { SkillAverage, CreateRecommendationData };
