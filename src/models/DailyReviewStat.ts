import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { User } from './User';

@Entity('daily_review_stats')
export class DailyReviewStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'date' })
  local_date: string;

  @Column({ type: 'varchar', length: 100 })
  timezone: string;

  @Column({ type: 'integer' })
  daily_goal: number;

  @Column({ type: 'integer' })
  cards_due_at_first_session: number;

  @Column({ type: 'integer' })
  required_reviews: number;

  @Column({ type: 'integer', default: 0 })
  cards_reviewed: number;

  @Column({ type: 'integer', default: 0 })
  unique_cards_reviewed: number;

  @Column({ type: 'integer', default: 0 })
  minutes_studied: number;

  @Column({ type: 'boolean', default: false })
  goal_completed: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'daily_review_stats', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
