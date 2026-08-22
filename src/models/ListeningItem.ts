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
  PracticeItemOption,
  PracticeItemAnswerKey,
} from './practice-json-types';
import type { ListeningSource } from './ListeningSource';

/**
 * Mirrors PracticeItem column-for-column (same PracticeItemOption/
 * PracticeItemAnswerKey JSONB shapes) so the objective-grading pure
 * functions in lib/practice/practice-attempt-grading.ts work unchanged
 * against a curated Listening question — see ListeningSource for why this
 * is a separate table rather than a practice_items row.
 */
@Entity('listening_items')
export class ListeningItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  source_id: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', nullable: true })
  options: PracticeItemOption[] | null;

  // Same select:false guard as PracticeItem.answer_key — never leaked in a
  // normal read, only via an explicit addSelect() in the grading path.
  @Column({ type: 'jsonb', select: false })
  answer_key: PracticeItemAnswerKey;

  @Column({ type: 'text', nullable: true, select: false })
  explanation: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  skill_tags: string[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('ListeningSource', 'items', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source: ListeningSource;
}
