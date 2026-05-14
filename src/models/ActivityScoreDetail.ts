import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ScoreCriterion } from './enums';
import type { ActivityScore } from './ActivityScore';

@Entity('activity_score_details')
export class ActivityScoreDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  activity_score_id: string;

  @Column({
    type: 'enum',
    enum: ScoreCriterion,
    enumName: 'score_criterion_enum',
  })
  criterion: ScoreCriterion;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  score: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  max_score: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('ActivityScore', 'score_details', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activity_score_id' })
  activity_score: ActivityScore;
}
