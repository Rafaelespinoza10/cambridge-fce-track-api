import type { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '@models/User';
import { UserProfile } from '@models/UserProfile';
import { UserGoal } from '@models/UserGoal';
import type { EnglishLevel, GoalStatus, TargetExam } from '@models/enums';

interface UpdateUserData {
  first_name?: string;
  last_name?: string;
}

interface UpsertProfileData {
  current_level?: EnglishLevel;
  target_exam?: TargetExam;
  target_score?: number;
  target_date?: string;
  study_days_per_week?: number;
  daily_study_minutes?: number;
  timezone?: string;
}

interface CreateGoalData {
  user_id: string;
  title: string;
  description?: string;
  target_exam?: TargetExam;
  target_score?: number;
  target_date?: string;
  status: GoalStatus;
}

interface UpdateGoalData {
  title?: string;
  description?: string;
  target_exam?: TargetExam;
  target_score?: number;
  target_date?: string;
  status?: GoalStatus;
}

class UsersRepository {
  private readonly userRepo: Repository<User>;
  private readonly profileRepo: Repository<UserProfile>;
  private readonly goalRepo: Repository<UserGoal>;

  constructor(dataSource: DataSource | EntityManager) {
    this.userRepo = dataSource.getRepository(User);
    this.profileRepo = dataSource.getRepository(UserProfile);
    this.goalRepo = dataSource.getRepository(UserGoal);
  }

  async findUserWithProfile(userId: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { id: userId },
      relations: ['profile'],
    });
  }

  async updateUser(userId: string, data: UpdateUserData): Promise<void> {
    await this.userRepo.update({ id: userId }, data);
  }

  async upsertProfile(userId: string, data: UpsertProfileData): Promise<void> {
    let profile = await this.profileRepo.findOne({ where: { user_id: userId } });

    if (profile === null) {
      profile = this.profileRepo.create({ user_id: userId, ...data });
    } else {
      Object.assign(profile, data);
    }

    await this.profileRepo.save(profile);
  }

  async findGoalsByUser(userId: string): Promise<UserGoal[]> {
    return this.goalRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async findGoalByIdAndUser(goalId: string, userId: string): Promise<UserGoal | null> {
    return this.goalRepo.findOne({ where: { id: goalId, user_id: userId } });
  }

  async createGoal(data: CreateGoalData): Promise<UserGoal> {
    const goal = this.goalRepo.create(data);
    return this.goalRepo.save(goal);
  }

  async updateGoal(goalId: string, data: UpdateGoalData): Promise<void> {
    await this.goalRepo.update({ id: goalId }, data);
  }

  async softDeleteGoal(goalId: string): Promise<void> {
    await this.goalRepo.softDelete({ id: goalId });
  }
}

export { UsersRepository };
