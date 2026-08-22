import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type {
  DailySessionItemOption,
  DailySessionItemAnswerKey,
} from './daily-session-json-types';
import type { DailySession } from './DailySession';

@Entity('daily_session_items')
export class DailySessionItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  daily_session_id: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', nullable: true })
  options: DailySessionItemOption[] | null;

  // Never returned by a normal read (draft before submit, or exposing the
  // correct answer to the client). Only an explicit addSelect() in the
  // internal evaluation query recovers it — see
  // DailySessionsRepository.findSessionWithAnswerKeysForEvaluation.
  @Column({ type: 'jsonb', select: false })
  answer_key: DailySessionItemAnswerKey;

  // Same reason as answer_key: can reveal the correct answer.
  @Column({ type: 'text', nullable: true, select: false })
  explanation: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  skill_tags: string[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('DailySession', 'items', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'daily_session_id' })
  daily_session: DailySession;
}
