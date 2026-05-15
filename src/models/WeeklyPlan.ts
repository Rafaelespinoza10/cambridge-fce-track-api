import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { WeekPlanStatus } from './enums';
import type { User } from './User';
import type { PlanDay } from './PlanDay';

@Entity('weekly_plans')
@Unique(['user_id', 'week_start_date'])
export class WeeklyPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'date' })
  week_start_date: string;

  @Column({ type: 'date' })
  week_end_date: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({
    type: 'enum',
    enum: WeekPlanStatus,
    enumName: 'week_plan_status_enum',
    default: WeekPlanStatus.DRAFT,
  })
  status: WeekPlanStatus;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'weekly_plans', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany('PlanDay', 'weekly_plan')
  plan_days: PlanDay[];
}
