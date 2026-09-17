import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import {
  MistakeErrorType,
  MistakeErrorSubtype,
  WeaknessReviewStatus,
  WeaknessReviewResult,
} from './enums';
import type { User } from './User';

/**
 * One scheduled retest of one weakness *pattern* — the "wait, then check it
 * again" half of the Mistake Bank loop:
 *
 *   mistake -> targeted practice -> mastery rises -> WAIT -> retest
 *           -> retention confirmed -> longer interval (or shorter)
 *
 * A row is an **event**, not a mutable schedule: once a retest is graded the
 * row is `completed` forever and a fresh `scheduled` row takes over. That is
 * what keeps the history ("scheduled / completed / result / interval used")
 * the mastery side can be analysed against later.
 *
 * At most one `scheduled` row may exist per (user, pattern) — enforced by a
 * pair of partial unique indexes (uq_weakness_reviews_active_with_subtype /
 * _no_subtype, split in two because a cast of the nullable error_subtype
 * enum isn't IMMUTABLE and can't live in a single expression index), not
 * merely by application code, so a user can never end up with the same
 * pattern due tomorrow AND in three days.
 *
 * This table stores **no score of its own**. Mastery stays fully derived
 * (see @lib/mistakes/mastery-score.ts); `mastery_score_before/after` are
 * snapshots kept purely so the completion screen can say "78% -> 84%"
 * without recomputing a historical score that is no longer reproducible.
 */
@Entity('weakness_reviews')
export class WeaknessReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  // ── Pattern identity ───────────────────────────────────────────────────────
  // The same columns MistakeConcept carries, so buildPatternKey() produces
  // an identical key from either side. A pattern is not a foreign key: it is
  // an aggregate of many MistakeConcepts and has no row of its own anywhere.

  @Column({ type: 'varchar', length: 50 })
  skill_slug: string;

  @Column({ type: 'varchar', length: 50 })
  exam_code: string;

  @Column({ type: 'varchar', length: 50 })
  paper_code: string;

  @Column({ type: 'varchar', length: 50 })
  part_code: string;

  @Column({
    type: 'enum',
    enum: MistakeErrorType,
    enumName: 'mistake_error_type_enum',
  })
  error_type: MistakeErrorType;

  @Column({
    type: 'enum',
    enum: MistakeErrorSubtype,
    enumName: 'mistake_error_subtype_enum',
    nullable: true,
  })
  error_subtype: MistakeErrorSubtype | null;

  // ── Schedule ───────────────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: WeaknessReviewStatus,
    enumName: 'weakness_review_status_enum',
    default: WeaknessReviewStatus.SCHEDULED,
  })
  status: WeaknessReviewStatus;

  /**
   * Always UTC. `due`/`overdue`/`upcoming` are NOT stored — they are this
   * timestamp compared against the clock (see resolveTiming), and the client
   * is the only thing that renders them in the user's own zone.
   */
  @Column({ type: 'timestamp with time zone' })
  due_at: Date;

  /** The ladder rung this review was scheduled at — see RETEST_CONSTANTS.INTERVAL_LADDER_DAYS. */
  @Column({ type: 'integer' })
  interval_days: number;

  /**
   * Recorded for later analysis only. The scheduler never reads it: the
   * ladder rung already encodes the streak, so this can never disagree with
   * the interval.
   */
  @Column({ type: 'integer', default: 0 })
  consecutive_successful_reviews: number;

  /** Mastery at the moment the review was scheduled — the "before" of the completion screen. */
  @Column({ type: 'integer' })
  mastery_score_before: number;

  // ── Outcome (null while scheduled) ─────────────────────────────────────────

  @Column({ type: 'timestamp with time zone', nullable: true })
  completed_at: Date | null;

  @Column({
    type: 'enum',
    enum: WeaknessReviewResult,
    enumName: 'weakness_review_result_enum',
    nullable: true,
  })
  result: WeaknessReviewResult | null;

  @Column({ type: 'integer', nullable: true })
  correct_count: number | null;

  @Column({ type: 'integer', nullable: true })
  total_count: number | null;

  /** Distinct lexical families answered correctly — why a 3/3 can still be a PARTIAL. */
  @Column({ type: 'integer', nullable: true })
  distinct_correct_families: number | null;

  @Column({ type: 'integer', nullable: true })
  mastery_score_after: number | null;

  /**
   * The retest exercise/attempt this review was answered through. Plain uuid
   * columns without a DB-level FK, exactly like MistakeOccurrence's: a
   * practice exercise is soft-deletable, and a review's history must outlive
   * it.
   */
  @Column({ type: 'uuid', nullable: true })
  practice_exercise_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  practice_attempt_id: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  // Unidirectional towards User (no inverse array), same explicit decision as
  // every other entity in this module.

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;
}
