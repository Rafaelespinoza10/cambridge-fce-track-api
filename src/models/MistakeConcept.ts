import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import {
  EnglishLevel,
  MistakeSource,
  MistakeErrorType,
  MistakeErrorSubtype,
  WordClass,
} from './enums';
import type { User } from './User';
import type { MistakeOccurrence } from './MistakeOccurrence';

/**
 * One row per (user, concept the user got wrong) — NOT one row per wrong
 * answer. Failing the same concept again bumps `times_wrong`/`last_wrong_at`
 * on the existing row (see MistakesRepository.upsertConcept) instead of
 * inserting a near-duplicate, and every individual occurrence still lives in
 * `mistake_occurrences`. That split is what later makes "times failed /
 * times right afterwards / last failed / frequency / mastery" answerable
 * without recomputing over duplicated rows.
 *
 * The identity is `concept_key` (see @lib/mistakes/mistake-concept-key.ts) —
 * deliberately readable, not a hash, so a row is inspectable in psql.
 */
@Entity('mistake_concepts')
export class MistakeConcept {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  /** Deterministic natural key, e.g. `uoe_part_3|responsible|responsibly`. Unique per user. */
  @Column({ type: 'varchar', length: 255 })
  concept_key: string;

  @Column({
    type: 'enum',
    enum: MistakeSource,
    enumName: 'mistake_source_enum',
  })
  source: MistakeSource;

  /** Matches the seeded `skills.slug` values (use-of-english, reading, …) — not a new taxonomy. */
  @Column({ type: 'varchar', length: 50 })
  skill_slug: string;

  // Plain strings, exactly like PracticeExercise/PracticeItem: the exam
  // catalog is in-memory (see practice-exam-catalog.ts), so a new exam/part
  // never needs a migration here either.
  @Column({ type: 'varchar', length: 50 })
  exam_code: string;

  @Column({ type: 'varchar', length: 50 })
  paper_code: string;

  @Column({ type: 'varchar', length: 50 })
  part_code: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  task_type: string | null;

  /**
   * The root word the item asked the student to transform, when the task
   * type has one and it could be extracted deterministically from the
   * prompt (Word Formation / Key Word Transformation). Never AI-inferred.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  base_word: string | null;

  // ── Snapshot of the most recent occurrence ────────────────────────────────
  // Denormalized on purpose: the Mistakes list renders from this table alone,
  // with no join against practice_items/practice_answers (both of which can
  // be soft-deleted with their exercise).

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'text' })
  correct_answer: string;

  @Column({ type: 'text' })
  last_user_answer: string;

  @Column({ type: 'text', nullable: true })
  explanation: string | null;

  /** Difficulty — reuses the exercise's own target level instead of inventing a scale. */
  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  target_level: EnglishLevel | null;

  // ── Classification (not populated yet — see MistakeErrorType) ─────────────

  @Column({
    type: 'enum',
    enum: MistakeErrorType,
    enumName: 'mistake_error_type_enum',
    default: MistakeErrorType.UNKNOWN,
  })
  error_type: MistakeErrorType;

  @Column({
    type: 'enum',
    enum: MistakeErrorSubtype,
    enumName: 'mistake_error_subtype_enum',
    nullable: true,
  })
  error_subtype: MistakeErrorSubtype | null;

  @Column({
    type: 'enum',
    enum: WordClass,
    enumName: 'word_class_enum',
    nullable: true,
  })
  expected_word_class: WordClass | null;

  @Column({
    type: 'enum',
    enum: WordClass,
    enumName: 'word_class_enum',
    nullable: true,
  })
  user_word_class: WordClass | null;

  // ── Counters (the base for a future mastery score) ────────────────────────

  @Column({ type: 'integer', default: 0 })
  times_wrong: number;

  /**
   * Times the user later answered this same concept correctly. Only ever
   * incremented on an already-existing concept — a correct answer never
   * creates one.
   */
  @Column({ type: 'integer', default: 0 })
  times_correct: number;

  @Column({ type: 'timestamp with time zone' })
  first_seen_at: Date;

  @Column({ type: 'timestamp with time zone' })
  last_wrong_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  last_correct_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  // Unidirectional towards User (no inverse array on User.ts), same explicit
  // decision as the Practice entities.

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany('MistakeOccurrence', 'concept')
  occurrences: MistakeOccurrence[];
}
