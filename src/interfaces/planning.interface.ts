import type {
  ActivityPriority,
  PlannedActivityStatus,
  WeekPlanStatus,
  DayOfWeek,
} from '../models/enums';

export interface CreateWeekPlanBody {
  weekStartDate: string;
  title?: string | null;
}

export interface AddPlannedActivityBody {
  activityTemplateId?: string | null;
  customActivityId?: string | null;
  title?: string;
  description?: string | null;
  skillId?: string | null;
  examSectionId?: string | null;
  estimatedDurationMinutes?: number | null;
  priority?: ActivityPriority;
  scheduledAt?: string | null;
}

export interface UpdatePlannedActivityBody {
  title?: string;
  description?: string | null;
  skillId?: string | null;
  examSectionId?: string | null;
  estimatedDurationMinutes?: number | null;
  priority?: ActivityPriority;
  status?: PlannedActivityStatus;
  scheduledAt?: string | null;
  completedAt?: string | null;
}

export interface MovePlannedActivityBody {
  targetDayId: string;
  targetOrder: number;
}

/** Skill metadata joined on read; accentColor is resolved in memory by slug. */
export interface SafePlannedActivitySkill {
  id: string;
  slug: string;
  name: string;
  accentColor: string;
}

export interface SafePlannedActivity {
  id: string;
  planDayId: string;
  activityTemplateId: string | null;
  customActivityId: string | null;
  title: string;
  description: string | null;
  skillId: string | null;
  skill: SafePlannedActivitySkill | null;
  examSectionId: string | null;
  scheduledOrder: number;
  estimatedDurationMinutes: number | null;
  priority: ActivityPriority;
  status: PlannedActivityStatus;
  scheduledAt: Date | null;
  completedAt: Date | null;
}

export interface SafePlanDay {
  id: string;
  dayOfWeek: DayOfWeek;
  date: string | null;
  notes: string | null;
  activities: SafePlannedActivity[];
}

export interface SafeWeeklyPlan {
  id: string;
  weekStartDate: string;
  weekEndDate: string;
  title: string | null;
  status: WeekPlanStatus;
  days: SafePlanDay[];
}
