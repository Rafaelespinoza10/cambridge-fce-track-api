import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { DayOfWeek } from './enums';
import type { WeeklyPlan } from './WeeklyPlan';
import type { PlannedActivity } from './PlannedActivity';

@Entity('plan_days')
@Unique(['weekly_plan_id', 'day_of_week'])
export class PlanDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  weekly_plan_id: string;

  @Column({
    type: 'enum',
    enum: DayOfWeek,
    enumName: 'day_of_week_enum',
  })
  day_of_week: DayOfWeek;

  @Column({ type: 'date', nullable: true })
  date: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('WeeklyPlan', 'plan_days', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'weekly_plan_id' })
  weekly_plan: WeeklyPlan;

  @OneToMany('PlannedActivity', 'plan_day')
  planned_activities: PlannedActivity[];
}
