import { getDatabaseConnection } from '@lib/shared/database';
import { fromCsv } from '@lib/shared/csv';
import { isValidUuid } from '@lib/shared/response';
import { ActivitiesRepository } from '@repositories/activities/activities.repository';
import { ScoreType } from '../../models/enums';
import type { Skill } from '../../models/Skill';
import type { ExamSection } from '../../models/ExamSection';
import type { ActivityTemplate } from '../../models/ActivityTemplate';
import type { CustomActivity } from '../../models/CustomActivity';
import type { ImportResult } from '@lib/shared/csv';
import type {
  SafeSkill,
  SafeExamSection,
  SafeActivityTemplate,
  SafeCustomActivity,
  CreateCustomActivityBody,
  UpdateCustomActivityBody,
  ExamSectionFilters,
  ActivityTemplateFilters,
  CustomActivityFilters,
  CustomActivityExportRow,
} from 'src/interfaces/activities/activities.interface';

function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

class ActivitiesService {
  private static toSafeSkill(skill: Skill): SafeSkill {
    return {
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
    };
  }

  private static toSafeExamSection(section: ExamSection): SafeExamSection {
    return {
      id: section.id,
      skillId: section.skill_id,
      skill: ActivitiesService.toSafeSkill(section.skill),
      name: section.name,
      slug: section.slug,
      description: section.description,
      maxScore: section.max_score,
      defaultDurationMinutes: section.default_duration_minutes,
    };
  }

  private static toSafeActivityTemplate(template: ActivityTemplate): SafeActivityTemplate {
    return {
      id: template.id,
      skillId: template.skill_id,
      examSectionId: template.exam_section_id,
      skill: ActivitiesService.toSafeSkill(template.skill),
      examSection: template.exam_section
        ? {
            id: template.exam_section.id,
            name: template.exam_section.name,
            slug: template.exam_section.slug,
          }
        : null,
      name: template.name,
      description: template.description,
      scoreType: template.score_type,
      defaultDurationMinutes: template.default_duration_minutes,
      maxScore: template.max_score,
      isActive: template.is_active,
    };
  }

  private static toSafeCustomActivity(activity: CustomActivity): SafeCustomActivity {
    return {
      id: activity.id,
      userId: activity.user_id,
      skillId: activity.skill_id,
      examSectionId: activity.exam_section_id,
      name: activity.name,
      description: activity.description,
      scoreType: activity.score_type,
      defaultDurationMinutes: activity.default_duration_minutes,
      maxScore: activity.max_score,
    };
  }

  async getSkills(): Promise<SafeSkill[]> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const skills = await repo.findSkills();
    return skills.map(function (skill: Skill): SafeSkill {
      return ActivitiesService.toSafeSkill(skill);
    });
  }

  async getExamSections(filters: ExamSectionFilters): Promise<SafeExamSection[]> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const sections = await repo.findExamSections(filters);
    return sections.map(function (section: ExamSection): SafeExamSection {
      return ActivitiesService.toSafeExamSection(section);
    });
  }

  async getActivityTemplates(filters: ActivityTemplateFilters): Promise<SafeActivityTemplate[]> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const templates = await repo.findActivityTemplates(filters);
    return templates.map(function (template: ActivityTemplate): SafeActivityTemplate {
      return ActivitiesService.toSafeActivityTemplate(template);
    });
  }

  async createCustomActivity(
    userId: string,
    body: CreateCustomActivityBody,
  ): Promise<SafeCustomActivity> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    if (body.skillId !== undefined) {
      const skill = await repo.findSkillById(body.skillId);
      if (skill === null) throw createError('Skill not found', 400);
    }

    if (body.examSectionId !== undefined) {
      const section = await repo.findExamSectionById(body.examSectionId);
      if (section === null) throw createError('Exam section not found', 400);

      if (body.skillId !== undefined && section.skill_id !== body.skillId) {
        throw createError('Exam section does not belong to the provided skill', 400);
      }
    }

    const activity = await repo.createCustomActivity(userId, body);
    return ActivitiesService.toSafeCustomActivity(activity);
  }

  async getCustomActivities(
    userId: string,
    filters: CustomActivityFilters,
  ): Promise<SafeCustomActivity[]> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const activities = await repo.findCustomActivitiesByUser(userId, filters);
    return activities.map(function (activity: CustomActivity): SafeCustomActivity {
      return ActivitiesService.toSafeCustomActivity(activity);
    });
  }

  async exportCustomActivities(
    userId: string,
    filters: CustomActivityFilters,
  ): Promise<CustomActivityExportRow[]> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const activities = await repo.findCustomActivitiesByUser(userId, filters);
    return activities.map(function (activity: CustomActivity): CustomActivityExportRow {
      return {
        activityId: activity.id,
        name: activity.name,
        description: activity.description ?? '',
        skillId: activity.skill_id ?? '',
        examSectionId: activity.exam_section_id ?? '',
        scoreType: activity.score_type ?? '',
        defaultDurationMinutes: activity.default_duration_minutes ?? '',
        maxScore: activity.max_score ?? '',
      };
    });
  }

  async updateCustomActivity(
    userId: string,
    activityId: string,
    body: UpdateCustomActivityBody,
  ): Promise<SafeCustomActivity> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const existing = await repo.findCustomActivityByIdAndUser(activityId, userId);
    if (existing === null) throw createError('Custom activity not found', 404);

    if (body.skillId !== undefined && body.skillId !== null) {
      const skill = await repo.findSkillById(body.skillId);
      if (skill === null) throw createError('Skill not found', 400);
    }

    if (body.examSectionId !== undefined && body.examSectionId !== null) {
      const section = await repo.findExamSectionById(body.examSectionId);
      if (section === null) throw createError('Exam section not found', 400);

      const effectiveSkillId = body.skillId !== undefined ? body.skillId : existing.skill_id;
      if (effectiveSkillId !== null && section.skill_id !== effectiveSkillId) {
        throw createError('Exam section does not belong to the provided skill', 400);
      }
    }

    await repo.updateCustomActivity(activityId, {
      ...(body.skillId !== undefined ? { skill_id: body.skillId } : {}),
      ...(body.examSectionId !== undefined ? { exam_section_id: body.examSectionId } : {}),
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.scoreType !== undefined ? { score_type: body.scoreType } : {}),
      ...(body.defaultDurationMinutes !== undefined
        ? { default_duration_minutes: body.defaultDurationMinutes }
        : {}),
      ...(body.maxScore !== undefined ? { max_score: body.maxScore } : {}),
    });

    const updated = await repo.findCustomActivityByIdAndUser(activityId, userId);
    if (updated === null) throw createError('Custom activity not found', 404);

    return ActivitiesService.toSafeCustomActivity(updated);
  }

  async deleteCustomActivity(userId: string, activityId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new ActivitiesRepository(ds);

    const existing = await repo.findCustomActivityByIdAndUser(activityId, userId);
    if (existing === null) throw createError('Custom activity not found', 404);

    await repo.softDeleteCustomActivity(activityId);
  }

  async importCustomActivities(userId: string, csvText: string): Promise<ImportResult> {
    let rows: Record<string, string>[];
    try {
      rows = fromCsv(csvText);
    } catch {
      throw createError('Invalid CSV content', 400);
    }

    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const row = rows[i];

      try {
        const name = (row['Name'] ?? '').trim();
        if (name === '') throw new Error('Name is required');

        const scoreTypeRaw = (row['Score Type'] ?? '').trim();
        if (!(Object.values(ScoreType) as string[]).includes(scoreTypeRaw)) {
          throw new Error(`Score Type must be one of: ${Object.values(ScoreType).join(', ')}`);
        }

        const skillId = (row['Skill ID'] ?? '').trim() || undefined;
        if (skillId !== undefined && !isValidUuid(skillId)) {
          throw new Error('Skill ID must be a valid UUID');
        }

        const examSectionId = (row['Exam Section ID'] ?? '').trim() || undefined;
        if (examSectionId !== undefined && !isValidUuid(examSectionId)) {
          throw new Error('Exam Section ID must be a valid UUID');
        }

        const description = (row['Description'] ?? '').trim() || undefined;

        const durationRaw = (row['Default Duration (min)'] ?? '').trim();
        let defaultDurationMinutes: number | undefined;
        if (durationRaw !== '') {
          defaultDurationMinutes = parseInt(durationRaw, 10);
          if (!Number.isInteger(defaultDurationMinutes) || defaultDurationMinutes <= 0) {
            throw new Error('Default Duration (min) must be a positive integer');
          }
        }

        const maxScoreRaw = (row['Max Score'] ?? '').trim();
        let maxScore: number | undefined;
        if (maxScoreRaw !== '') {
          maxScore = parseInt(maxScoreRaw, 10);
          if (!Number.isInteger(maxScore) || maxScore <= 0) {
            throw new Error('Max Score must be a positive integer');
          }
        }

        await this.createCustomActivity(userId, {
          name,
          description,
          scoreType: scoreTypeRaw as ScoreType,
          skillId,
          examSectionId,
          defaultDurationMinutes,
          maxScore,
        });

        result.imported++;
      } catch (err) {
        result.errors.push({
          row: rowNum,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return result;
  }
}

export { ActivitiesService };
