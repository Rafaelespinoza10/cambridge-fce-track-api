import { getDatabaseConnection } from '../../lib/database';
import { UsersRepository } from 'src/repositories/users.repository';
import { GoalStatus } from '../../models/enums';
import type { User } from '../../models/User';
import type { UserProfile } from '../../models/UserProfile';
import type { UserGoal } from '../../models/UserGoal';
import type {
  CreateGoalBody,
  ProfileData,
  SafeGoal,
  SafeProfile,
  UpdateGoalBody,
  UserMeResult,
} from 'src/interfaces/users/users.interface';

function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

class UsersService {
  private static toSafeProfile(profile: UserProfile | null | undefined): SafeProfile | null {
    if (profile == null) return null;
    return {
      currentLevel: profile.current_level,
      targetExam: profile.target_exam,
      targetScore: profile.target_score,
      targetDate: profile.target_date,
      studyDaysPerWeek: profile.study_days_per_week,
      dailyStudyMinutes: profile.daily_study_minutes,
      timezone: profile.timezone,
    };
  }

  private static toSafeGoal(goal: UserGoal): SafeGoal {
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      targetExam: goal.target_exam,
      targetScore: goal.target_score,
      targetDate: goal.target_date,
      status: goal.status,
      createdAt: goal.created_at,
    };
  }

  private static toUserMeResult(user: User): UserMeResult {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name ?? '',
      lastName: user.last_name ?? '',
      role: user.role,
      isActive: user.is_active,
      profile: UsersService.toSafeProfile(user.profile as UserProfile | null),
    };
  }

  async getMe(userId: string): Promise<UserMeResult> {
    const ds = await getDatabaseConnection();
    const repo = new UsersRepository(ds);

    const user = await repo.findUserWithProfile(userId);
    if (user === null) {
      throw createError('User not found', 401);
    }

    return UsersService.toUserMeResult(user);
  }

  async updateProfile(userId: string, body: ProfileData): Promise<UserMeResult> {
    const ds = await getDatabaseConnection();
    const repo = new UsersRepository(ds);

    if (body.firstName !== undefined || body.lastName !== undefined) {
      await repo.updateUser(userId, {
        ...(body.firstName !== undefined ? { first_name: body.firstName } : {}),
        ...(body.lastName !== undefined ? { last_name: body.lastName } : {}),
      });
    }

    const hasProfileData =
      body.currentLevel !== undefined ||
      body.targetExam !== undefined ||
      body.targetScore !== undefined ||
      body.targetDate !== undefined ||
      body.studyDaysPerWeek !== undefined ||
      body.dailyStudyMinutes !== undefined ||
      body.timezone !== undefined;

    if (hasProfileData) {
      await repo.upsertProfile(userId, {
        ...(body.currentLevel !== undefined ? { current_level: body.currentLevel } : {}),
        ...(body.targetExam !== undefined ? { target_exam: body.targetExam } : {}),
        ...(body.targetScore !== undefined ? { target_score: body.targetScore } : {}),
        ...(body.targetDate !== undefined ? { target_date: body.targetDate } : {}),
        ...(body.studyDaysPerWeek !== undefined
          ? { study_days_per_week: body.studyDaysPerWeek }
          : {}),
        ...(body.dailyStudyMinutes !== undefined
          ? { daily_study_minutes: body.dailyStudyMinutes }
          : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      });
    }

    const user = await repo.findUserWithProfile(userId);
    if (user === null) {
      throw createError('User not found', 401);
    }

    return UsersService.toUserMeResult(user);
  }

  async getGoals(userId: string): Promise<SafeGoal[]> {
    const ds = await getDatabaseConnection();
    const repo = new UsersRepository(ds);

    const goals = await repo.findGoalsByUser(userId);
    return goals.map(function (goal: UserGoal): SafeGoal {
      return UsersService.toSafeGoal(goal);
    });
  }

  async createGoal(userId: string, body: CreateGoalBody): Promise<SafeGoal> {
    const ds = await getDatabaseConnection();
    const repo = new UsersRepository(ds);

    const goal = await repo.createGoal({
      user_id: userId,
      title: body.title.trim(),
      description: body.description,
      target_exam: body.targetExam,
      target_score: body.targetScore,
      target_date: body.targetDate,
      status: body.status ?? GoalStatus.ACTIVE,
    });

    return UsersService.toSafeGoal(goal);
  }

  async updateGoal(userId: string, goalId: string, body: UpdateGoalBody): Promise<SafeGoal> {
    const ds = await getDatabaseConnection();
    const repo = new UsersRepository(ds);

    const existing = await repo.findGoalByIdAndUser(goalId, userId);
    if (existing === null) {
      throw createError('Goal not found', 404);
    }

    await repo.updateGoal(goalId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.targetExam !== undefined ? { target_exam: body.targetExam } : {}),
      ...(body.targetScore !== undefined ? { target_score: body.targetScore } : {}),
      ...(body.targetDate !== undefined ? { target_date: body.targetDate } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    const updated = await repo.findGoalByIdAndUser(goalId, userId);
    if (updated === null) {
      throw createError('Goal not found', 404);
    }

    return UsersService.toSafeGoal(updated);
  }

  async deleteGoal(userId: string, goalId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new UsersRepository(ds);

    const existing = await repo.findGoalByIdAndUser(goalId, userId);
    if (existing === null) {
      throw createError('Goal not found', 404);
    }

    await repo.softDeleteGoal(goalId);
  }
}

export { UsersService };
