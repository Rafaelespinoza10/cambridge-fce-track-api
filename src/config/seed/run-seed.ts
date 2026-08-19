import 'reflect-metadata';
import { Repository } from 'typeorm';
import { AppDataSource } from '../database';
import { Skill } from '../../models/Skill';
import { ExamSection } from '../../models/ExamSection';
import { ActivityTemplate } from '../../models/ActivityTemplate';
import { Resource } from '../../models/Resource';
import { ResourceType } from '../../models/enums';
import { SKILLS_SEED } from './data/skills';
import { EXAM_SECTIONS_SEED } from './data/exam-sections';
import { ACTIVITY_TEMPLATES_SEED } from './data/activity-templates';
import { GLOBAL_RESOURCES_SEED } from './data/global-resources';

async function seedSkills(repo: Repository<Skill>): Promise<Map<string, string>> {
  for (const row of SKILLS_SEED) {
    await repo.upsert(
      {
        name: row.name,
        slug: row.slug,
        description: row.description,
      },
      ['slug'],
    );
  }

  const skills = await repo.find();
  const bySlug = new Map<string, string>();
  for (const skill of skills) {
    bySlug.set(skill.slug, skill.id);
  }
  return bySlug;
}

async function seedExamSections(
  repo: Repository<ExamSection>,
  skillIdsBySlug: Map<string, string>,
): Promise<Map<string, string>> {
  for (const row of EXAM_SECTIONS_SEED) {
    const skillId = skillIdsBySlug.get(row.skillSlug);
    if (!skillId) {
      throw new Error(`Skill not found for slug "${row.skillSlug}"`);
    }

    await repo.upsert(
      {
        skill_id: skillId,
        slug: row.slug,
        name: row.name,
        description: row.description,
        max_score: row.maxScore,
        default_duration_minutes: row.defaultDurationMinutes,
      },
      ['slug'],
    );
  }

  const sections = await repo.find();
  const bySlug = new Map<string, string>();
  for (const section of sections) {
    bySlug.set(section.slug, section.id);
  }
  return bySlug;
}

async function seedActivityTemplates(
  repo: Repository<ActivityTemplate>,
  skillIdsBySlug: Map<string, string>,
  sectionIdsBySlug: Map<string, string>,
): Promise<void> {
  for (const row of ACTIVITY_TEMPLATES_SEED) {
    const skillId = skillIdsBySlug.get(row.skillSlug);
    if (!skillId) {
      throw new Error(`Skill not found for slug "${row.skillSlug}"`);
    }

    let examSectionId: string | null = null;
    if (row.examSectionSlug !== null) {
      examSectionId = sectionIdsBySlug.get(row.examSectionSlug) ?? null;
      if (examSectionId === null) {
        throw new Error(`Exam section not found for slug "${row.examSectionSlug}"`);
      }
    }

    const existing = await repo.findOne({
      where: { skill_id: skillId, name: row.name },
    });

    const payload = {
      skill_id: skillId,
      exam_section_id: examSectionId,
      name: row.name,
      description: row.description,
      score_type: row.scoreType,
      default_duration_minutes: row.defaultDurationMinutes,
      max_score: row.maxScore,
      is_active: row.isActive,
    };

    if (existing) {
      await repo.update(existing.id, payload);
    } else {
      await repo.save(repo.create(payload));
    }
  }
}

async function seedGlobalResources(repo: Repository<Resource>): Promise<void> {
  for (const row of GLOBAL_RESOURCES_SEED) {
    const existing = await repo.findOne({
      where: { url: row.url, is_global: true },
    });

    const payload = {
      user_id: null,
      title: row.title,
      description: row.description,
      resource_type: ResourceType.LINK,
      url: row.url,
      storage_key: null,
      is_global: true,
    };

    if (existing) {
      await repo.update(existing.id, payload);
    } else {
      await repo.save(repo.create(payload));
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  await AppDataSource.initialize();

  try {
    const skillRepo = AppDataSource.getRepository(Skill);
    const sectionRepo = AppDataSource.getRepository(ExamSection);
    const templateRepo = AppDataSource.getRepository(ActivityTemplate);
    const resourceRepo = AppDataSource.getRepository(Resource);

    console.log('[seed] Skills…');
    const skillIdsBySlug = await seedSkills(skillRepo);
    console.log(`[seed]   ${skillIdsBySlug.size} skills`);

    console.log('[seed] Exam sections…');
    const sectionIdsBySlug = await seedExamSections(sectionRepo, skillIdsBySlug);
    console.log(`[seed]   ${sectionIdsBySlug.size} exam sections`);

    console.log('[seed] Activity templates…');
    await seedActivityTemplates(templateRepo, skillIdsBySlug, sectionIdsBySlug);
    console.log(`[seed]   ${ACTIVITY_TEMPLATES_SEED.length} templates processed`);

    console.log('[seed] Global resources…');
    await seedGlobalResources(resourceRepo);
    console.log(`[seed]   ${GLOBAL_RESOURCES_SEED.length} global resources processed`);

    console.log('[seed] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
