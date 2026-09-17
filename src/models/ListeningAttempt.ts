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
import { ListeningAttemptStatus } from './enums';
import type {
  ListeningAttemptAnswerEntry,
  ListeningAttemptFeedbackSummary,
} from './listening-json-types';
import type { User } from './User';
import type { ListeningSource } from './ListeningSource';

/**
 * A student's own attempt against a curated ListeningSource — see that
 * model's doc comment for the content it plays back. Unlike
 * PracticeAttempt, there is no "one active attempt per user" constraint:
 * ListeningSource content is static and free to replay, so a user can
 * start a fresh attempt against the same (or a different) source any time,
 * even while another is still in_progress. `answers` carries the full
 * graded submission inline (see listening-json-types.ts) rather than a
 * separate child table.
 */
@Entity('listening_attempts')
export class ListeningAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  source_id: string;

  @Column({
    type: 'enum',
    enum: ListeningAttemptStatus,
    enumName: 'listening_attempt_status_enum',
    default: ListeningAttemptStatus.IN_PROGRESS,
  })
  status: ListeningAttemptStatus;

  @Column({ type: 'timestamp with time zone' })
  started_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'integer', nullable: true })
  correct_count: number | null;

  @Column({ type: 'integer' })
  total_count: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  percentage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  answers: ListeningAttemptAnswerEntry[] | null;

  @Column({ type: 'jsonb', nullable: true })
  feedback_summary: ListeningAttemptFeedbackSummary | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('ListeningSource')
  @JoinColumn({ name: 'source_id' })
  source: ListeningSource;
}
