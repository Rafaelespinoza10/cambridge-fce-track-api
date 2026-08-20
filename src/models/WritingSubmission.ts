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
import { WritingSubmissionStatus } from './enums';
import type { WritingFeedback } from './writing-json-types';
import type { User } from './User';
import type { WritingTask } from './WritingTask';
import type { PlanDay } from './PlanDay';

@Entity('writing_submissions')
export class WritingSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  task_id: string;

  @Column({
    type: 'enum',
    enum: WritingSubmissionStatus,
    enumName: 'writing_submission_status_enum',
    default: WritingSubmissionStatus.IN_PROGRESS,
  })
  status: WritingSubmissionStatus;

  @Column({ type: 'timestamp with time zone' })
  started_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'text', nullable: true })
  submitted_text: string | null;

  @Column({ type: 'integer', nullable: true })
  word_count: number | null;

  @Column({ type: 'jsonb', nullable: true })
  feedback: WritingFeedback | null;

  // Plan day this submission should register as a planned_activity against
  // once it's graded (see SubmitWritingSubmissionService) — captured at
  // start time so the user picks the target day before generating.
  @Column({ type: 'uuid', nullable: true })
  plan_day_id: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────
  // NOTA: igual que PracticeAttempt -> PracticeExercise, la integridad
  // writing_submissions.user_id = writing_tasks.user_id la garantiza una FK
  // compuesta (task_id, user_id) -> writing_tasks(id, user_id), definida solo
  // en la migración SQL. ON DELETE NO ACTION (protege el historial) +
  // DEFERRABLE INITIALLY DEFERRED (solo pospone cuándo se valida la FK).

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('WritingTask')
  @JoinColumn({ name: 'task_id' })
  task: WritingTask;

  @ManyToOne('PlanDay', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plan_day_id' })
  plan_day: PlanDay | null;
}
