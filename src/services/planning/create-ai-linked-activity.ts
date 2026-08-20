import type { EntityManager } from 'typeorm';
import { PlannedActivity } from '../../models/PlannedActivity';
import { Skill } from '../../models/Skill';
import { ExamSection } from '../../models/ExamSection';
import { PlannedActivityStatus, PlannedActivitySource } from '../../models/enums';

interface CreateAiLinkedPlannedActivityInput {
  planDayId: string;
  title: string;
  skillSlug: string;
  examSectionSlug: string | null;
  estimatedDurationMinutes: number | null;
  completedAt: Date;
  practiceAttemptId?: string;
  writingSubmissionId?: string;
}

/**
 * Called from inside the Practice/Writing submit transaction once an
 * AI-generated session actually completes (see the "register on completion
 * only" decision) — never at generation/start time. Exactly one of
 * practiceAttemptId/writingSubmissionId must be provided, matching the
 * chk_planned_activities_ai_link constraint added in
 * AddAiLinkedPlannedActivities.
 *
 * Takes a bare EntityManager (not PlanningRepository, which is DataSource-only)
 * so it composes into a transaction that a different service already owns.
 */
async function createAiLinkedPlannedActivity(
  manager: EntityManager,
  input: CreateAiLinkedPlannedActivityInput,
): Promise<PlannedActivity> {
  const skill = await manager.getRepository(Skill).findOne({ where: { slug: input.skillSlug } });

  const examSection =
    input.examSectionSlug !== null
      ? await manager.getRepository(ExamSection).findOne({ where: { slug: input.examSectionSlug } })
      : null;

  const plannedActivityRepo = manager.getRepository(PlannedActivity);
  const scheduledOrder = await plannedActivityRepo.count({
    where: { plan_day_id: input.planDayId },
  });

  const entity = plannedActivityRepo.create({
    plan_day_id: input.planDayId,
    title: input.title,
    description: null,
    skill_id: skill?.id ?? null,
    exam_section_id: examSection?.id ?? null,
    scheduled_order: scheduledOrder,
    estimated_duration_minutes: input.estimatedDurationMinutes,
    status: PlannedActivityStatus.COMPLETED,
    scheduled_at: input.completedAt,
    completed_at: input.completedAt,
    source: PlannedActivitySource.AI_GENERATED,
    practice_attempt_id: input.practiceAttemptId ?? null,
    writing_submission_id: input.writingSubmissionId ?? null,
  });

  return plannedActivityRepo.save(entity);
}

export { createAiLinkedPlannedActivity };
export type { CreateAiLinkedPlannedActivityInput };
