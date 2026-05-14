import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { GoalStatus, TargetExam } from './enums';
import type { User } from './User';

@Entity('user_goals')
export class UserGoal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'enum',
    enum: TargetExam,
    enumName: 'target_exam_enum',
    nullable: true,
  })
  target_exam: TargetExam | null;

  @Column({ type: 'integer', nullable: true })
  target_score: number | null;

  @Column({ type: 'date', nullable: true })
  target_date: string | null;

  @Column({
    type: 'enum',
    enum: GoalStatus,
    enumName: 'goal_status_enum',
    default: GoalStatus.ACTIVE,
  })
  status: GoalStatus;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'goals', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
