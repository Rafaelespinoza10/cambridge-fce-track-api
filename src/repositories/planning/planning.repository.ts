import type { DataSource, EntityManager, Repository } from 'typeorm';
import { WeeklyPlan } from '@models/WeeklyPlan';
import { PlanDay } from '@models/PlanDay';
import { PlannedActivity } from '@models/PlannedActivity';
import { ActivityTemplate } from '@models/ActivityTemplate';
import { CustomActivity } from '@models/CustomActivity';
import { Skill } from '@models/Skill';
import { WeekPlanStatus, DayOfWeek, ActivityPriority } from '@models/enums';
import type { PlannedActivityStatus } from '@models/enums';

// ── Constants ──────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

const DAY_ORDER: Record<DayOfWeek, number> = {
  [DayOfWeek.MONDAY]: 0,
  [DayOfWeek.TUESDAY]: 1,
  [DayOfWeek.WEDNESDAY]: 2,
  [DayOfWeek.THURSDAY]: 3,
  [DayOfWeek.FRIDAY]: 4,
  [DayOfWeek.SATURDAY]: 5,
  [DayOfWeek.SUNDAY]: 6,
};

// ── Internal data shapes ───────────────────────────────────────────────────────

interface CreateWeekPlanData {
  userId: string;
  weekStartDate: string;
  weekEndDate: string;
  title: string | null;
}

interface CreatePlannedActivityData {
  planDayId: string;
  activityTemplateId: string | null;
  customActivityId: string | null;
  title: string;
  description: string | null;
  skillId: string | null;
  examSectionId: string | null;
  scheduledOrder: number;
  estimatedDurationMinutes: number | null;
  priority: ActivityPriority;
  scheduledAt: Date | null;
}

interface UpdatePlannedActivityData {
  title?: string;
  description?: string | null;
  skill_id?: string | null;
  exam_section_id?: string | null;
  estimated_duration_minutes?: number | null;
  priority?: ActivityPriority;
  status?: PlannedActivityStatus;
  scheduled_at?: Date | null;
  completed_at?: Date | null;
}

interface ActivityHistoryQueryOptions {
  userId: string;
  skillId?: string;
  status?: PlannedActivityStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

interface ActivityHistoryExportOptions {
  userId: string;
  skillId?: string;
  status?: PlannedActivityStatus;
  from?: Date;
  to?: Date;
}

// ── Repository ─────────────────────────────────────────────────────────────────

class PlanningRepository {
  private readonly weeklyPlanRepo: Repository<WeeklyPlan>;
  private readonly planDayRepo: Repository<PlanDay>;
  private readonly plannedActivityRepo: Repository<PlannedActivity>;
  private readonly activityTemplateRepo: Repository<ActivityTemplate>;
  private readonly customActivityRepo: Repository<CustomActivity>;
  private readonly skillRepo: Repository<Skill>;
  private readonly dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.weeklyPlanRepo = dataSource.getRepository(WeeklyPlan);
    this.planDayRepo = dataSource.getRepository(PlanDay);
    this.plannedActivityRepo = dataSource.getRepository(PlannedActivity);
    this.activityTemplateRepo = dataSource.getRepository(ActivityTemplate);
    this.customActivityRepo = dataSource.getRepository(CustomActivity);
    this.skillRepo = dataSource.getRepository(Skill);
  }

  async findWeekPlanByUserAndStartDate(
    userId: string,
    weekStartDate: string,
  ): Promise<WeeklyPlan | null> {
    return this.weeklyPlanRepo.findOne({
      where: { user_id: userId, week_start_date: weekStartDate },
    });
  }

  async createWeekPlanWithDays(data: CreateWeekPlanData): Promise<WeeklyPlan> {
    const result = await this.dataSource.transaction(async function (
      manager: EntityManager,
    ): Promise<WeeklyPlan> {
      const plan = manager.create(WeeklyPlan, {
        user_id: data.userId,
        week_start_date: data.weekStartDate,
        week_end_date: data.weekEndDate,
        title: data.title,
        status: WeekPlanStatus.ACTIVE,
      });
      const savedPlan = await manager.save(WeeklyPlan, plan);

      const startDate = new Date(data.weekStartDate + 'T00:00:00.000Z');
      const dayEntities: PlanDay[] = DAYS_OF_WEEK.map(function (
        dayOfWeek: DayOfWeek,
        index: number,
      ): PlanDay {
        const dayDate = new Date(startDate);
        dayDate.setUTCDate(startDate.getUTCDate() + index);
        return manager.create(PlanDay, {
          weekly_plan_id: savedPlan.id,
          day_of_week: dayOfWeek,
          date: dayDate.toISOString().slice(0, 10),
          notes: null,
        });
      });

      const savedDays = await manager.save(PlanDay, dayEntities);

      savedDays.sort(function (a: PlanDay, b: PlanDay): number {
        return DAY_ORDER[a.day_of_week] - DAY_ORDER[b.day_of_week];
      });

      savedPlan.plan_days = savedDays.map(function (day: PlanDay): PlanDay {
        day.planned_activities = [];
        return day;
      });

      return savedPlan;
    });

    return result;
  }

  async findCurrentWeekPlan(userId: string, today: string): Promise<WeeklyPlan | null> {
    const plan = await this.weeklyPlanRepo
      .createQueryBuilder('wp')
      .leftJoinAndSelect('wp.plan_days', 'pd')
      .leftJoinAndSelect('pd.planned_activities', 'pa', 'pa.deleted_at IS NULL')
      .leftJoinAndSelect('pa.skill', 'skill')
      .where('wp.user_id = :userId', { userId })
      .andWhere('wp.week_start_date <= :today', { today })
      .andWhere('wp.week_end_date >= :today', { today })
      .andWhere('wp.deleted_at IS NULL')
      .getOne();

    if (plan === null) return null;

    plan.plan_days.sort(function (a: PlanDay, b: PlanDay): number {
      return DAY_ORDER[a.day_of_week] - DAY_ORDER[b.day_of_week];
    });

    plan.plan_days.forEach(function (day: PlanDay): void {
      day.planned_activities.sort(function (a: PlannedActivity, b: PlannedActivity): number {
        return a.scheduled_order - b.scheduled_order;
      });
    });

    return plan;
  }

  async findWeekPlanByIdAndUser(weekId: string, userId: string): Promise<WeeklyPlan | null> {
    const plan = await this.weeklyPlanRepo
      .createQueryBuilder('wp')
      .leftJoinAndSelect('wp.plan_days', 'pd')
      .leftJoinAndSelect('pd.planned_activities', 'pa', 'pa.deleted_at IS NULL')
      .leftJoinAndSelect('pa.skill', 'skill')
      .where('wp.id = :weekId', { weekId })
      .andWhere('wp.user_id = :userId', { userId })
      .andWhere('wp.deleted_at IS NULL')
      .getOne();

    if (plan === null) return null;

    plan.plan_days.sort(function (a: PlanDay, b: PlanDay): number {
      return DAY_ORDER[a.day_of_week] - DAY_ORDER[b.day_of_week];
    });

    plan.plan_days.forEach(function (day: PlanDay): void {
      day.planned_activities.sort(function (a: PlannedActivity, b: PlannedActivity): number {
        return a.scheduled_order - b.scheduled_order;
      });
    });

    return plan;
  }

  async findPlanDayByIdAndWeekPlan(
    dayId: string,
    weekPlanId: string,
    userId: string,
  ): Promise<PlanDay | null> {
    return this.planDayRepo
      .createQueryBuilder('pd')
      .innerJoin('pd.weekly_plan', 'wp')
      .where('pd.id = :dayId', { dayId })
      .andWhere('pd.weekly_plan_id = :weekPlanId', { weekPlanId })
      .andWhere('wp.user_id = :userId', { userId })
      .andWhere('wp.deleted_at IS NULL')
      .getOne();
  }

  // Used by Practice/Writing start flows, which only ever receive a
  // planDayId (not a weekId) from the client — unlike findPlanDayByIdAndWeekPlan.
  async findPlanDayByIdAndUser(dayId: string, userId: string): Promise<PlanDay | null> {
    return this.planDayRepo
      .createQueryBuilder('pd')
      .innerJoin('pd.weekly_plan', 'wp')
      .where('pd.id = :dayId', { dayId })
      .andWhere('wp.user_id = :userId', { userId })
      .andWhere('wp.deleted_at IS NULL')
      .getOne();
  }

  async findActivityTemplateById(id: string): Promise<ActivityTemplate | null> {
    return this.activityTemplateRepo.findOne({ where: { id } });
  }

  async findCustomActivityByIdAndUser(id: string, userId: string): Promise<CustomActivity | null> {
    return this.customActivityRepo.findOne({ where: { id, user_id: userId } });
  }

  async findSkillByName(name: string): Promise<Skill | null> {
    return this.skillRepo
      .createQueryBuilder('skill')
      .where('LOWER(skill.name) = LOWER(:name)', { name })
      .getOne();
  }

  async findPlanDayByDate(weeklyPlanId: string, date: string): Promise<PlanDay | null> {
    return this.planDayRepo.findOne({ where: { weekly_plan_id: weeklyPlanId, date } });
  }

  async findPlannedActivityByTitleAndDay(
    planDayId: string,
    title: string,
  ): Promise<PlannedActivity | null> {
    return this.plannedActivityRepo
      .createQueryBuilder('pa')
      .where('pa.plan_day_id = :planDayId', { planDayId })
      .andWhere('LOWER(pa.title) = LOWER(:title)', { title })
      .andWhere('pa.deleted_at IS NULL')
      .getOne();
  }

  async createPlannedActivityForImport(data: {
    planDayId: string;
    title: string;
    skillId: string | null;
    estimatedDurationMinutes: number | null;
    status: PlannedActivityStatus;
    scheduledAt: Date;
    completedAt: Date | null;
    scheduledOrder: number;
  }): Promise<PlannedActivity> {
    const entity = this.plannedActivityRepo.create({
      plan_day_id: data.planDayId,
      title: data.title,
      skill_id: data.skillId,
      estimated_duration_minutes: data.estimatedDurationMinutes,
      priority: ActivityPriority.MEDIUM,
      status: data.status,
      scheduled_at: data.scheduledAt,
      completed_at: data.completedAt,
      scheduled_order: data.scheduledOrder,
    });
    return this.plannedActivityRepo.save(entity);
  }

  async countActivitiesInDay(planDayId: string): Promise<number> {
    return this.plannedActivityRepo.count({ where: { plan_day_id: planDayId } });
  }

  async createPlannedActivity(data: CreatePlannedActivityData): Promise<PlannedActivity> {
    const entity = this.plannedActivityRepo.create({
      plan_day_id: data.planDayId,
      activity_template_id: data.activityTemplateId,
      custom_activity_id: data.customActivityId,
      title: data.title,
      description: data.description,
      skill_id: data.skillId,
      exam_section_id: data.examSectionId,
      scheduled_order: data.scheduledOrder,
      estimated_duration_minutes: data.estimatedDurationMinutes,
      priority: data.priority,
      scheduled_at: data.scheduledAt,
    });
    return this.plannedActivityRepo.save(entity);
  }

  async findPlannedActivityWithContext(id: string): Promise<PlannedActivity | null> {
    return this.plannedActivityRepo
      .createQueryBuilder('pa')
      .innerJoinAndSelect('pa.plan_day', 'pd')
      .innerJoinAndSelect('pd.weekly_plan', 'wp')
      .leftJoinAndSelect('pa.skill', 'skill')
      .where('pa.id = :id', { id })
      .andWhere('pa.deleted_at IS NULL')
      .andWhere('wp.deleted_at IS NULL')
      .getOne();
  }

  async updatePlannedActivity(id: string, data: UpdatePlannedActivityData): Promise<void> {
    await this.plannedActivityRepo.update({ id }, data);
  }

  async softDeletePlannedActivity(id: string): Promise<void> {
    await this.plannedActivityRepo.softDelete({ id });
  }

  async findActivityHistory(
    options: ActivityHistoryQueryOptions,
  ): Promise<[PlannedActivity[], number]> {
    const qb = this.plannedActivityRepo
      .createQueryBuilder('pa')
      .innerJoinAndSelect('pa.plan_day', 'pd')
      .innerJoinAndSelect('pd.weekly_plan', 'wp')
      .leftJoinAndSelect('pa.skill', 'skill')
      .where('wp.user_id = :userId', { userId: options.userId })
      .andWhere('pa.deleted_at IS NULL')
      .andWhere('wp.deleted_at IS NULL');

    if (options.skillId !== undefined) {
      qb.andWhere('pa.skill_id = :skillId', { skillId: options.skillId });
    }
    if (options.status !== undefined) {
      qb.andWhere('pa.status = :status', { status: options.status });
    }
    if (options.from !== undefined) {
      qb.andWhere('pa.scheduled_at >= :from', { from: options.from });
    }
    if (options.to !== undefined) {
      qb.andWhere('pa.scheduled_at <= :to', { to: options.to });
    }

    qb.orderBy('pa.scheduled_at', 'DESC', 'NULLS LAST')
      .addOrderBy('pa.created_at', 'DESC')
      .skip(options.offset)
      .take(options.limit);

    return qb.getManyAndCount();
  }

  async findActivityHistoryForExport(
    options: ActivityHistoryExportOptions,
  ): Promise<PlannedActivity[]> {
    const qb = this.plannedActivityRepo
      .createQueryBuilder('pa')
      .innerJoinAndSelect('pa.plan_day', 'pd')
      .innerJoinAndSelect('pd.weekly_plan', 'wp')
      .leftJoinAndSelect('pa.skill', 'skill')
      .where('wp.user_id = :userId', { userId: options.userId })
      .andWhere('pa.deleted_at IS NULL')
      .andWhere('wp.deleted_at IS NULL');

    if (options.skillId !== undefined) {
      qb.andWhere('pa.skill_id = :skillId', { skillId: options.skillId });
    }
    if (options.status !== undefined) {
      qb.andWhere('pa.status = :status', { status: options.status });
    }
    if (options.from !== undefined) {
      qb.andWhere('pa.scheduled_at >= :from', { from: options.from });
    }
    if (options.to !== undefined) {
      qb.andWhere('pa.scheduled_at <= :to', { to: options.to });
    }

    qb.orderBy('pa.scheduled_at', 'DESC', 'NULLS LAST').addOrderBy('pa.created_at', 'DESC');

    return qb.getMany();
  }

  async moveActivityTransaction(
    activityId: string,
    sourceDayId: string,
    targetDayId: string,
    targetOrder: number,
  ): Promise<PlannedActivity> {
    return this.dataSource.transaction(async function (
      manager: EntityManager,
    ): Promise<PlannedActivity> {
      const paRepo = manager.getRepository(PlannedActivity);

      const sourceActivities = await paRepo.find({
        where: { plan_day_id: sourceDayId },
        order: { scheduled_order: 'ASC' },
      });

      const isSameDay = sourceDayId === targetDayId;

      if (isSameDay) {
        const movingActivity = sourceActivities.find(function (a: PlannedActivity): boolean {
          return a.id === activityId;
        });
        if (movingActivity === undefined) throw new Error('Activity not found in source day');

        const others = sourceActivities.filter(function (a: PlannedActivity): boolean {
          return a.id !== activityId;
        });
        const insertAt = Math.min(targetOrder, others.length);
        others.splice(insertAt, 0, movingActivity);

        for (let i = 0; i < others.length; i++) {
          await paRepo.update({ id: others[i].id }, { scheduled_order: i });
        }

        const updated = await paRepo.findOne({ where: { id: activityId } });
        if (updated === null) throw new Error('Activity not found after reorder');
        return updated;
      }

      // Different days: remove from source, renumber source
      const sourceWithoutMoved = sourceActivities.filter(function (a: PlannedActivity): boolean {
        return a.id !== activityId;
      });
      for (let i = 0; i < sourceWithoutMoved.length; i++) {
        await paRepo.update({ id: sourceWithoutMoved[i].id }, { scheduled_order: i });
      }

      // Get target day activities and insert moved activity at targetOrder
      const targetActivities = await paRepo.find({
        where: { plan_day_id: targetDayId },
        order: { scheduled_order: 'ASC' },
      });

      const insertAt = Math.min(targetOrder, targetActivities.length);
      targetActivities.splice(insertAt, 0, { id: activityId } as PlannedActivity);

      for (let i = 0; i < targetActivities.length; i++) {
        if (targetActivities[i].id === activityId) {
          await paRepo.update({ id: activityId }, { plan_day_id: targetDayId, scheduled_order: i });
        } else {
          await paRepo.update({ id: targetActivities[i].id }, { scheduled_order: i });
        }
      }

      const updated = await paRepo.findOne({ where: { id: activityId } });
      if (updated === null) throw new Error('Activity not found after move');
      return updated;
    });
  }
}

export { PlanningRepository };
export type { CreateWeekPlanData, CreatePlannedActivityData, UpdatePlannedActivityData };
