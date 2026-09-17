import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MistakeSource } from './enums';
import type { User } from './User';
import type { MistakeConcept } from './MistakeConcept';

/**
 * The append-only event log behind the Mistake Bank: exactly one row per
 * wrong answer, pointing at the MistakeConcept it belongs to. Correct
 * answers never produce a row here (they only bump the concept's
 * `times_correct`).
 *
 * The `practice_*` columns are nullable because a later source (mock
 * attempt, daily session) will fill its own columns instead — the row always
 * says which one it is through `source`. They are plain uuid columns without
 * a DB-level FK to practice_attempts/items/answers on purpose: those rows
 * belong to a soft-deletable exercise, and a mistake must survive its
 * exercise being deleted (everything the UI needs is snapshotted on the
 * concept).
 */
@Entity('mistake_occurrences')
export class MistakeOccurrence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  concept_id: string;

  @Column({
    type: 'enum',
    enum: MistakeSource,
    enumName: 'mistake_source_enum',
  })
  source: MistakeSource;

  @Column({ type: 'uuid', nullable: true })
  practice_attempt_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  practice_exercise_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  practice_item_id: string | null;

  /**
   * The graded PracticeAnswer this occurrence was derived from. Unique among
   * non-null values (uq_mistake_occurrences_practice_answer), so replaying a
   * submission can never double-insert an occurrence or double-count
   * `times_wrong`.
   */
  @Column({ type: 'uuid', nullable: true })
  practice_answer_id: string | null;

  @Column({ type: 'text' })
  user_answer: string;

  @Column({ type: 'text', nullable: true })
  normalized_answer: string | null;

  @Column({ type: 'text' })
  correct_answer: string;

  /** An unanswered item is still a mistake, but a different one from a wrong attempt at an answer. */
  @Column({ type: 'boolean', default: false })
  is_unanswered: boolean;

  @Column({ type: 'timestamp with time zone' })
  occurred_at: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('MistakeConcept', 'occurrences', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'concept_id' })
  concept: MistakeConcept;
}
