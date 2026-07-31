import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { ReviewRating, FlashcardStatus } from './enums';
import type { User } from './User';
import type { Flashcard } from './Flashcard';
import type { StudySession } from './StudySession';

@Entity('flashcard_reviews')
export class FlashcardReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  flashcard_id: string;

  @Column({ type: 'uuid' })
  study_session_id: string;

  @Column({ type: 'uuid' })
  idempotency_key: string;

  @Column({
    type: 'enum',
    enum: ReviewRating,
    enumName: 'review_rating_enum',
  })
  rating: ReviewRating;

  @Column({
    type: 'enum',
    enum: FlashcardStatus,
    enumName: 'flashcard_status_enum',
  })
  previous_status: FlashcardStatus;

  @Column({
    type: 'enum',
    enum: FlashcardStatus,
    enumName: 'flashcard_status_enum',
  })
  new_status: FlashcardStatus;

  @Column({ type: 'timestamp with time zone' })
  previous_next_review_at: Date;

  @Column({ type: 'timestamp with time zone' })
  new_next_review_at: Date;

  @Column({ type: 'integer' })
  previous_interval_minutes: number;

  @Column({ type: 'integer' })
  new_interval_minutes: number;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  previous_ease_factor: string;

  @Column({ type: 'numeric', precision: 4, scale: 2 })
  new_ease_factor: string;

  @Column({ type: 'integer' })
  previous_repetitions: number;

  @Column({ type: 'integer' })
  new_repetitions: number;

  @Column({ type: 'integer' })
  previous_lapses: number;

  @Column({ type: 'integer' })
  new_lapses: number;

  @Column({ type: 'integer', nullable: true })
  response_time_ms: number | null;

  @Column({ type: 'timestamp with time zone' })
  reviewed_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  // NOTA: `flashcard_id`/`study_session_id` son relaciones simples para
  // queries/joins. La integridad `flashcard_reviews.user_id = flashcards.user_id`
  // y `flashcard_reviews.user_id = study_sessions.user_id` la garantizan dos FKs
  // compuestas definidas solo en la migración SQL (ver Flashcard.ts/StudySession.ts).

  @ManyToOne('User', 'flashcard_reviews', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Flashcard', 'reviews')
  @JoinColumn({ name: 'flashcard_id' })
  flashcard: Flashcard;

  @ManyToOne('StudySession', 'flashcard_reviews')
  @JoinColumn({ name: 'study_session_id' })
  study_session: StudySession;
}
