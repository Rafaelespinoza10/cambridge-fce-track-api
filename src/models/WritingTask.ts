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
} from 'typeorm';
import { PracticeExerciseSource, WritingTaskType, EnglishLevel } from './enums';
import type { WritingTaskGenerationMetadata } from './writing-json-types';
import type { User } from './User';
import type { WritingSubmission } from './WritingSubmission';

@Entity('writing_tasks')
export class WritingTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({
    type: 'enum',
    enum: WritingTaskType,
    enumName: 'writing_task_type_enum',
  })
  task_type: WritingTaskType;

  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  target_level: EnglishLevel | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  instructions: string;

  @Column({ type: 'integer' })
  min_words: number;

  @Column({ type: 'integer' })
  max_words: number;

  @Column({ type: 'integer' })
  time_limit_seconds: number;

  @Column({
    type: 'enum',
    enum: PracticeExerciseSource,
    enumName: 'practice_exercise_source_enum',
  })
  source: PracticeExerciseSource;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  prompt_version: string | null;

  @Column({ type: 'jsonb', nullable: true })
  generation_metadata: WritingTaskGenerationMetadata | null;

  // Client-supplied, checked before ever calling the LLM (see
  // GenerateWritingTaskService) so a retried request replays the
  // already-persisted task instead of generating (and billing) again.
  // Unique per (user_id, idempotency_key) among non-deleted rows only — see
  // the AddWritingDomain migration.
  @Column({ type: 'uuid' })
  idempotency_key: string;

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

  @OneToMany('WritingSubmission', 'task')
  submissions: WritingSubmission[];
}
