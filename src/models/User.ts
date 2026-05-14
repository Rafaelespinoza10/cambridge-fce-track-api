import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { UserRole } from './enums';
import type { UserProfile } from './UserProfile';
import type { UserGoal } from './UserGoal';
import type { WeeklyPlan } from './WeeklyPlan';
import type { CustomActivity } from './CustomActivity';
import type { ActivityScore } from './ActivityScore';
import type { EvidenceFile } from './EvidenceFile';
import type { MockTest } from './MockTest';
import type { Resource } from './Resource';
import type { Recommendation } from './Recommendation';
import type { StudySession } from './StudySession';
import type { NotificationPreference } from './NotificationPreference';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  first_name: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  last_name: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role_enum',
    default: UserRole.STUDENT,
  })
  role: UserRole;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  email_verified_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToOne('UserProfile', 'user')
  profile: UserProfile;

  @OneToOne('NotificationPreference', 'user')
  notification_preference: NotificationPreference;

  @OneToMany('UserGoal', 'user')
  goals: UserGoal[];

  @OneToMany('WeeklyPlan', 'user')
  weekly_plans: WeeklyPlan[];

  @OneToMany('CustomActivity', 'user')
  custom_activities: CustomActivity[];

  @OneToMany('ActivityScore', 'user')
  activity_scores: ActivityScore[];

  @OneToMany('EvidenceFile', 'user')
  evidence_files: EvidenceFile[];

  @OneToMany('MockTest', 'user')
  mock_tests: MockTest[];

  @OneToMany('Resource', 'user')
  resources: Resource[];

  @OneToMany('Recommendation', 'user')
  recommendations: Recommendation[];

  @OneToMany('StudySession', 'user')
  study_sessions: StudySession[];
}
