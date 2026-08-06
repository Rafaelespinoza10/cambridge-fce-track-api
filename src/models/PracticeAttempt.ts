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
import { PracticeAttemptStatus } from './enums';
import type { PracticeAttemptFeedbackSummary } from './practice-json-types';
import type { User } from './User';
import type { PracticeExercise } from './PracticeExercise';

@Entity('practice_attempts')
export class PracticeAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  exercise_id: string;

  @Column({
    type: 'enum',
    enum: PracticeAttemptStatus,
    enumName: 'practice_attempt_status_enum',
    default: PracticeAttemptStatus.IN_PROGRESS,
  })
  status: PracticeAttemptStatus;

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
  feedback_summary: PracticeAttemptFeedbackSummary | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────
  // NOTA: `exercise_id` es una relación simple para queries/joins. La
  // integridad `practice_attempts.user_id = practice_exercises.user_id` la
  // garantiza una FK compuesta (exercise_id, user_id) → practice_exercises(id,
  // user_id), definida solo en la migración SQL (NO ACTION DEFERRABLE, para no
  // borrar historial si el ejercicio se hard-deletea) — no existe como
  // relación TypeORM independiente.

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('PracticeExercise')
  @JoinColumn({ name: 'exercise_id' })
  exercise: PracticeExercise;
}
