import type { DataSource, Repository } from 'typeorm';
import { Skill } from '../models/Skill';
import { ExamSection } from '../models/ExamSection';
import { ActivityTemplate } from '../models/ActivityTemplate';
import { CustomActivity } from '../models/CustomActivity';
import type { ScoreType } from '../models/enums';
import type {
  CreateCustomActivityBody,
  ExamSectionFilters,
  ActivityTemplateFilters,
  CustomActivityFilters,
} from '../interfaces/activities.interface';

interface UpdateCustomActivityData {
  skill_id?: string | null;
  exam_section_id?: string | null;
  name?: string;
  description?: string | null;
  score_type?: ScoreType;
  default_duration_minutes?: number | null;
  max_score?: number | null;
}

class ActivitiesRepository {
  private readonly skillRepo: Repository<Skill>;
  private readonly examSectionRepo: Repository<ExamSection>;
  private readonly templateRepo: Repository<ActivityTemplate>;
  private readonly customActivityRepo: Repository<CustomActivity>;

  constructor(dataSource: DataSource) {
    this.skillRepo = dataSource.getRepository(Skill);
    this.examSectionRepo = dataSource.getRepository(ExamSection);
    this.templateRepo = dataSource.getRepository(ActivityTemplate);
    this.customActivityRepo = dataSource.getRepository(CustomActivity);
  }

  async findSkills(): Promise<Skill[]> {
    return this.skillRepo.find({ order: { name: 'ASC' } });
  }

  async findExamSections(filters: ExamSectionFilters): Promise<ExamSection[]> {
    const qb = this.examSectionRepo
      .createQueryBuilder('es')
      .leftJoinAndSelect('es.skill', 'skill')
      .orderBy('es.name', 'ASC');

    if (filters.skillId !== undefined) {
      qb.andWhere('es.skill_id = :skillId', { skillId: filters.skillId });
    }

    if (filters.skillSlug !== undefined) {
      qb.andWhere('skill.slug = :skillSlug', { skillSlug: filters.skillSlug });
    }

    return qb.getMany();
  }

  async findActivityTemplates(filters: ActivityTemplateFilters): Promise<ActivityTemplate[]> {
    const qb = this.templateRepo
      .createQueryBuilder('at')
      .leftJoinAndSelect('at.skill', 'skill')
      .leftJoinAndSelect('at.exam_section', 'exam_section')
      .orderBy('at.name', 'ASC');

    if (filters.skillId !== undefined) {
      qb.andWhere('at.skill_id = :skillId', { skillId: filters.skillId });
    }

    if (filters.skillSlug !== undefined) {
      qb.andWhere('skill.slug = :skillSlug', { skillSlug: filters.skillSlug });
    }

    if (filters.examSectionId !== undefined) {
      qb.andWhere('at.exam_section_id = :examSectionId', { examSectionId: filters.examSectionId });
    }

    if (filters.scoreType !== undefined) {
      qb.andWhere('at.score_type = :scoreType', { scoreType: filters.scoreType });
    }

    if (filters.isActive !== undefined) {
      qb.andWhere('at.is_active = :isActive', { isActive: filters.isActive });
    }

    return qb.getMany();
  }

  async findSkillById(id: string): Promise<Skill | null> {
    return this.skillRepo.findOne({ where: { id } });
  }

  async findExamSectionById(id: string): Promise<ExamSection | null> {
    return this.examSectionRepo.findOne({ where: { id } });
  }

  async createCustomActivity(
    userId: string,
    body: CreateCustomActivityBody,
  ): Promise<CustomActivity> {
    const entity = this.customActivityRepo.create({
      user_id: userId,
      skill_id: body.skillId ?? null,
      exam_section_id: body.examSectionId ?? null,
      name: body.name.trim(),
      description: body.description ?? null,
      score_type: body.scoreType,
      default_duration_minutes: body.defaultDurationMinutes ?? null,
      max_score: body.maxScore ?? null,
    });
    return this.customActivityRepo.save(entity);
  }

  async findCustomActivitiesByUser(
    userId: string,
    filters: CustomActivityFilters,
  ): Promise<CustomActivity[]> {
    const qb = this.customActivityRepo
      .createQueryBuilder('ca')
      .where('ca.user_id = :userId', { userId })
      .orderBy('ca.created_at', 'DESC');

    if (filters.skillId !== undefined) {
      qb.andWhere('ca.skill_id = :skillId', { skillId: filters.skillId });
    }

    if (filters.skillSlug !== undefined) {
      qb.leftJoin('ca.skill', 'skill');
      qb.andWhere('skill.slug = :skillSlug', { skillSlug: filters.skillSlug });
    }

    if (filters.examSectionId !== undefined) {
      qb.andWhere('ca.exam_section_id = :examSectionId', { examSectionId: filters.examSectionId });
    }

    if (filters.scoreType !== undefined) {
      qb.andWhere('ca.score_type = :scoreType', { scoreType: filters.scoreType });
    }

    return qb.getMany();
  }

  async findCustomActivityByIdAndUser(id: string, userId: string): Promise<CustomActivity | null> {
    return this.customActivityRepo.findOne({ where: { id, user_id: userId } });
  }

  async updateCustomActivity(id: string, data: UpdateCustomActivityData): Promise<void> {
    await this.customActivityRepo.update({ id }, data);
  }

  async softDeleteCustomActivity(id: string): Promise<void> {
    await this.customActivityRepo.softDelete({ id });
  }
}

export { ActivitiesRepository };
export type { UpdateCustomActivityData };
