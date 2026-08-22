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
import { DailySessionSubmissionStatus } from './enums';
import type {
  DailySessionComprehensionAnswerRecord,
  DailySessionSentenceSubmission,
  DailySessionSentenceFeedback,
} from './daily-session-json-types';
import type { User } from './User';
import type { DailySession } from './DailySession';

@Entity('daily_session_submissions')
export class DailySessionSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  daily_session_id: string;

  @Column({
    type: 'enum',
    enum: DailySessionSubmissionStatus,
    enumName: 'daily_session_submission_status_enum',
    default: DailySessionSubmissionStatus.IN_PROGRESS,
  })
  status: DailySessionSubmissionStatus;

  @Column({ type: 'timestamp with time zone' })
  started_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  comprehension_answers: DailySessionComprehensionAnswerRecord[] | null;

  @Column({ type: 'integer', nullable: true })
  comprehension_correct_count: number | null;

  @Column({ type: 'integer', nullable: true })
  comprehension_total_count: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  comprehension_percentage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  sentence_submissions: DailySessionSentenceSubmission[] | null;

  @Column({ type: 'jsonb', nullable: true })
  sentence_feedback: DailySessionSentenceFeedback | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────
  // Same as PracticeAttempt -> PracticeExercise: the integrity constraint
  // daily_session_submissions.user_id = daily_sessions.user_id is enforced by
  // a composite FK (daily_session_id, user_id) -> daily_sessions(id, user_id),
  // defined only in the migration SQL. ON DELETE NO ACTION (protects
  // history) + DEFERRABLE INITIALLY DEFERRED (only postpones when the FK is
  // checked).

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('DailySession')
  @JoinColumn({ name: 'daily_session_id' })
  daily_session: DailySession;
}
