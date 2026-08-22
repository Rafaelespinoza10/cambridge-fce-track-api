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
import { DailySessionSource, EnglishLevel } from './enums';
import type {
  DailySessionSentenceTarget,
  DailySessionGenerationMetadata,
} from './daily-session-json-types';
import type { User } from './User';
import type { DailySessionItem } from './DailySessionItem';

@Entity('daily_sessions')
export class DailySession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  // The idempotency key for this entity — see
  // uq_daily_sessions_user_session_date. Server-computed from requestedAt +
  // the user's profile timezone (src/lib/shared/timezone.ts), never
  // client-supplied.
  @Column({ type: 'date' })
  session_date: string;

  @Column({ type: 'varchar', length: 100 })
  timezone: string;

  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  target_level: EnglishLevel | null;

  @Column({ type: 'varchar', length: 150 })
  topic: string;

  @Column({ type: 'varchar', length: 255 })
  reading_title: string;

  @Column({ type: 'text' })
  reading_instructions: string;

  @Column({ type: 'text' })
  reading_passage: string;

  @Column({ type: 'integer' })
  item_count: number;

  @Column({ type: 'text' })
  sentence_task_instructions: string;

  // Not select:false — unlike answer_key, there is no "correct answer" to
  // hide here. Correctness is judged by the LLM against a rubric at grading
  // time, so the targets themselves are safe to read normally.
  @Column({ type: 'jsonb' })
  sentence_targets: DailySessionSentenceTarget[];

  @Column({
    type: 'enum',
    enum: DailySessionSource,
    enumName: 'daily_session_source_enum',
  })
  source: DailySessionSource;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  prompt_version: string | null;

  @Column({ type: 'jsonb', nullable: true })
  generation_metadata: DailySessionGenerationMetadata | null;

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

  @OneToMany('DailySessionItem', 'daily_session')
  items: DailySessionItem[];
}
