import type { EnglishLevel, GoalStatus, TargetExam, UserRole } from '../../models/enums';

export interface ProfileData {
  firstName?: string;
  lastName?: string;
  currentLevel?: EnglishLevel;
  targetExam?: TargetExam;
  targetScore?: number;
  targetDate?: string;
  studyDaysPerWeek?: number;
  dailyStudyMinutes?: number;
  timezone?: string;
}

export interface CreateGoalBody {
  title: string;
  description?: string;
  targetExam?: TargetExam;
  targetScore?: number;
  targetDate?: string;
  status?: GoalStatus;
}

export interface UpdateGoalBody {
  title?: string;
  description?: string;
  targetExam?: TargetExam;
  targetScore?: number;
  targetDate?: string;
  status?: GoalStatus;
}

export interface SafeProfile {
  currentLevel: EnglishLevel | null;
  targetExam: TargetExam | null;
  targetScore: number | null;
  targetDate: string | null;
  studyDaysPerWeek: number | null;
  dailyStudyMinutes: number | null;
  timezone: string | null;
}

export interface UserMeResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  profile: SafeProfile | null;
}

export interface SafeGoal {
  id: string;
  title: string;
  description: string | null;
  targetExam: TargetExam | null;
  targetScore: number | null;
  targetDate: string | null;
  status: GoalStatus;
  createdAt: Date;
}
