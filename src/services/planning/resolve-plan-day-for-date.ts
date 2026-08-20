import type { EntityManager } from 'typeorm';
import { WeeklyPlan } from '../../models/WeeklyPlan';
import { PlanDay } from '../../models/PlanDay';
import { WeekPlanStatus, DayOfWeek } from '../../models/enums';

const DAYS_OF_WEEK: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOfWeek(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

/**
 * Finds (or creates, with all 7 days) the week plan that owns `dateKey` for
 * `userId`, then returns that day's id. Used to default an AI-generated
 * Practice/Writing session to "today's" plan day when the user didn't pick
 * one explicitly via the Plan/Home "Add Activity" chooser, and by the
 * historical backfill script — same find-or-create shape as
 * PlanningRepository.createWeekPlanWithDays (manual registration path),
 * just composable inside a caller-owned transaction via a bare EntityManager.
 */
export async function resolvePlanDayIdForDate(
  manager: EntityManager,
  userId: string,
  dateKey: string,
): Promise<string> {
  const weeklyPlanRepo = manager.getRepository(WeeklyPlan);
  const planDayRepo = manager.getRepository(PlanDay);
  const weekStart = mondayOfWeek(dateKey);

  let plan = await weeklyPlanRepo.findOne({
    where: { user_id: userId, week_start_date: weekStart },
  });

  if (plan === null) {
    plan = await weeklyPlanRepo.save(
      weeklyPlanRepo.create({
        user_id: userId,
        week_start_date: weekStart,
        week_end_date: addDays(weekStart, 6),
        title: null,
        status: WeekPlanStatus.ACTIVE,
      }),
    );

    const startDate = new Date(weekStart + 'T00:00:00.000Z');
    const dayEntities = DAYS_OF_WEEK.map((dayOfWeek, index) => {
      const dayDate = new Date(startDate);
      dayDate.setUTCDate(startDate.getUTCDate() + index);
      return planDayRepo.create({
        weekly_plan_id: (plan as WeeklyPlan).id,
        day_of_week: dayOfWeek,
        date: dayDate.toISOString().slice(0, 10),
        notes: null,
      });
    });
    await planDayRepo.save(dayEntities);
  }

  const day = await planDayRepo.findOne({
    where: { weekly_plan_id: plan.id, date: dateKey },
  });
  if (day === null) {
    throw new Error(`Plan day not found for user ${userId} on ${dateKey} (week ${weekStart})`);
  }
  return day.id;
}
