import { getDatabaseConnection } from '../lib/database';
import { getSkillAccentColor } from '../lib/skill-display';
import { PlanningRepository } from '../repositories/planning.repository';
import { ActivityPriority, PlannedActivityStatus } from '../models/enums';
import type { WeeklyPlan } from '../models/WeeklyPlan';
import type { PlanDay } from '../models/PlanDay';
import type { PlannedActivity } from '../models/PlannedActivity';
import type { Skill } from '../models/Skill';
import type {
  CreateWeekPlanBody,
  AddPlannedActivityBody,
  UpdatePlannedActivityBody,
  MovePlannedActivityBody,
  ActivityHistoryFilters,
  SafeWeeklyPlan,
  SafePlanDay,
  SafePlannedActivity,
  SafePlannedActivitySkill,
  SafeActivityHistoryItem,
} from '../interfaces/planning.interface';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !isNaN(new Date(value + 'T00:00:00.000Z').getTime());
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function toSafePlannedActivitySkill(skill: Skill): SafePlannedActivitySkill {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    accentColor: getSkillAccentColor(skill.slug),
  };
}

function toSafePlannedActivity(pa: PlannedActivity): SafePlannedActivity {
  return {
    id: pa.id,
    planDayId: pa.plan_day_id,
    activityTemplateId: pa.activity_template_id,
    customActivityId: pa.custom_activity_id,
    title: pa.title,
    description: pa.description,
    skillId: pa.skill_id,
    skill:
      pa.skill !== undefined && pa.skill !== null ? toSafePlannedActivitySkill(pa.skill) : null,
    examSectionId: pa.exam_section_id,
    scheduledOrder: pa.scheduled_order,
    estimatedDurationMinutes: pa.estimated_duration_minutes,
    priority: pa.priority,
    status: pa.status,
    scheduledAt: pa.scheduled_at,
    completedAt: pa.completed_at,
  };
}

function toSafePlanDay(day: PlanDay): SafePlanDay {
  return {
    id: day.id,
    dayOfWeek: day.day_of_week,
    date: day.date,
    notes: day.notes,
    activities: (day.planned_activities ?? []).map(function (
      pa: PlannedActivity,
    ): SafePlannedActivity {
      return toSafePlannedActivity(pa);
    }),
  };
}

function toSafeActivityHistoryItem(pa: PlannedActivity): SafeActivityHistoryItem {
  return {
    ...toSafePlannedActivity(pa),
    weeklyPlanId: pa.plan_day.weekly_plan_id,
    date: pa.plan_day.date,
  };
}

function toSafeWeeklyPlan(plan: WeeklyPlan): SafeWeeklyPlan {
  return {
    id: plan.id,
    weekStartDate: plan.week_start_date,
    weekEndDate: plan.week_end_date,
    title: plan.title,
    status: plan.status,
    days: (plan.plan_days ?? []).map(function (day: PlanDay): SafePlanDay {
      return toSafePlanDay(day);
    }),
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

class PlanningService {
  async createWeekPlan(userId: string, body: CreateWeekPlanBody): Promise<SafeWeeklyPlan> {
    if (!isValidDateString(body.weekStartDate)) {
      throw createError('weekStartDate must be a valid date in YYYY-MM-DD format', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const existing = await repo.findWeekPlanByUserAndStartDate(userId, body.weekStartDate);
    if (existing !== null) {
      const full = await repo.findWeekPlanByIdAndUser(existing.id, userId);
      if (full === null) throw createError('Week plan not found', 404);
      return toSafeWeeklyPlan(full);
    }

    const weekEndDate = addDays(body.weekStartDate, 6);

    const plan = await repo.createWeekPlanWithDays({
      userId,
      weekStartDate: body.weekStartDate,
      weekEndDate,
      title: body.title ?? null,
    });

    return toSafeWeeklyPlan(plan);
  }

  async getCurrentPlan(userId: string): Promise<SafeWeeklyPlan | null> {
    const today = todayISODate();
    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const plan = await repo.findCurrentWeekPlan(userId, today);
    if (plan === null) return null;

    return toSafeWeeklyPlan(plan);
  }

  async getWeekPlan(userId: string, weekId: string): Promise<SafeWeeklyPlan> {
    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const plan = await repo.findWeekPlanByIdAndUser(weekId, userId);
    if (plan === null) throw createError('Week plan not found', 404);

    return toSafeWeeklyPlan(plan);
  }

  async addActivity(
    userId: string,
    weekId: string,
    dayId: string,
    body: AddPlannedActivityBody,
  ): Promise<SafePlannedActivity> {
    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const day = await repo.findPlanDayByIdAndWeekPlan(dayId, weekId, userId);
    if (day === null) throw createError('Plan day not found', 404);

    if (
      body.activityTemplateId !== undefined &&
      body.activityTemplateId !== null &&
      body.customActivityId !== undefined &&
      body.customActivityId !== null
    ) {
      throw createError('Provide either activityTemplateId or customActivityId, not both', 400);
    }

    let resolvedTitle = (body.title ?? '').trim();

    if (body.activityTemplateId !== undefined && body.activityTemplateId !== null) {
      const template = await repo.findActivityTemplateById(body.activityTemplateId);
      if (template === null) throw createError('Activity template not found', 400);
      if (resolvedTitle === '') resolvedTitle = template.name;
    }

    if (body.customActivityId !== undefined && body.customActivityId !== null) {
      const custom = await repo.findCustomActivityByIdAndUser(body.customActivityId, userId);
      if (custom === null) throw createError('Custom activity not found', 404);
    }

    if (resolvedTitle === '') {
      throw createError('title is required', 400);
    }

    const scheduledOrder = await repo.countActivitiesInDay(dayId);

    let scheduledAt: Date | null = null;
    if (body.scheduledAt !== undefined && body.scheduledAt !== null) {
      const parsed = new Date(body.scheduledAt);
      if (isNaN(parsed.getTime()))
        throw createError('scheduledAt must be a valid ISO timestamp', 400);
      scheduledAt = parsed;
    }

    const activity = await repo.createPlannedActivity({
      planDayId: dayId,
      activityTemplateId: body.activityTemplateId ?? null,
      customActivityId: body.customActivityId ?? null,
      title: resolvedTitle,
      description: body.description ?? null,
      skillId: body.skillId ?? null,
      examSectionId: body.examSectionId ?? null,
      scheduledOrder,
      estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
      priority: body.priority ?? ActivityPriority.MEDIUM,
      scheduledAt,
    });

    const withSkill = await repo.findPlannedActivityWithContext(activity.id);
    if (withSkill === null) throw createError('Planned activity not found', 404);

    return toSafePlannedActivity(withSkill);
  }

  async updateActivity(
    userId: string,
    plannedActivityId: string,
    body: UpdatePlannedActivityBody,
  ): Promise<SafePlannedActivity> {
    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const existing = await repo.findPlannedActivityWithContext(plannedActivityId);
    if (existing === null || existing.plan_day.weekly_plan.user_id !== userId) {
      throw createError('Planned activity not found', 404);
    }

    const updateData: Parameters<PlanningRepository['updatePlannedActivity']>[1] = {};

    if (body.title !== undefined) {
      if (body.title.trim() === '') throw createError('title must not be empty', 400);
      updateData.title = body.title.trim();
    }

    if (body.description !== undefined) updateData.description = body.description;
    if (body.skillId !== undefined) updateData.skill_id = body.skillId;
    if (body.examSectionId !== undefined) updateData.exam_section_id = body.examSectionId;
    if (body.estimatedDurationMinutes !== undefined)
      updateData.estimated_duration_minutes = body.estimatedDurationMinutes;
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.status !== undefined) updateData.status = body.status;

    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt === null) {
        updateData.scheduled_at = null;
      } else {
        const parsed = new Date(body.scheduledAt);
        if (isNaN(parsed.getTime()))
          throw createError('scheduledAt must be a valid ISO timestamp', 400);
        updateData.scheduled_at = parsed;
      }
    }

    if (body.completedAt !== undefined) {
      if (body.completedAt === null) {
        updateData.completed_at = null;
      } else {
        const parsed = new Date(body.completedAt);
        if (isNaN(parsed.getTime()))
          throw createError('completedAt must be a valid ISO timestamp', 400);
        updateData.completed_at = parsed;
      }
    }

    // Auto-assign completedAt when marking as completed
    if (body.status === PlannedActivityStatus.COMPLETED && body.completedAt === undefined) {
      updateData.completed_at = new Date();
    }

    await repo.updatePlannedActivity(plannedActivityId, updateData);

    const updated = await repo.findPlannedActivityWithContext(plannedActivityId);
    if (updated === null) throw createError('Planned activity not found', 404);

    return toSafePlannedActivity(updated);
  }

  async deleteActivity(userId: string, plannedActivityId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const existing = await repo.findPlannedActivityWithContext(plannedActivityId);
    if (existing === null || existing.plan_day.weekly_plan.user_id !== userId) {
      throw createError('Planned activity not found', 404);
    }

    await repo.softDeletePlannedActivity(plannedActivityId);
  }

  async moveActivity(
    userId: string,
    plannedActivityId: string,
    body: MovePlannedActivityBody,
  ): Promise<SafePlannedActivity> {
    const ds = await getDatabaseConnection();
    const repo = new PlanningRepository(ds);

    const existing = await repo.findPlannedActivityWithContext(plannedActivityId);
    if (existing === null || existing.plan_day.weekly_plan.user_id !== userId) {
      throw createError('Planned activity not found', 404);
    }

    const weekPlanId = existing.plan_day.weekly_plan_id;
    const sourceDayId = existing.plan_day_id;

    // Verify target day belongs to the same weekly plan and same user
    const targetDay = await repo.findPlanDayByIdAndWeekPlan(body.targetDayId, weekPlanId, userId);
    if (targetDay === null) {
      throw createError('Target day not found or does not belong to the same weekly plan', 404);
    }

    await repo.moveActivityTransaction(
      plannedActivityId,
      sourceDayId,
      body.targetDayId,
      body.targetOrder,
    );

    const moved = await repo.findPlannedActivityWithContext(plannedActivityId);
    if (moved === null) throw createError('Planned activity not found', 404);

    return toSafePlannedActivity(moved);
  }

  async getActivityHistory(
    userId: string,
    filters: ActivityHistoryFilters,
  ): Promise<{
    data: SafeActivityHistoryItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;

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
    const repo = new PlanningRepository(ds);

    const [activities, total] = await repo.findActivityHistory({
      userId,
      skillId: filters.skillId,
      status: filters.status,
      from: fromDate,
      to: toDate,
      limit,
      offset,
    });

    return { data: activities.map(toSafeActivityHistoryItem), total, limit, offset };
  }
}

export { PlanningService };
