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
import { FlashcardType, FlashcardStatus, EnglishLevel } from './enums';
import type { User } from './User';
import type { Deck } from './Deck';
import type { FlashcardReview } from './FlashcardReview';

@Entity('flashcards')
export class Flashcard {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  deck_id: string;

  @Column({
    type: 'enum',
    enum: FlashcardType,
    enumName: 'flashcard_type_enum',
  })
  type: FlashcardType;

  @Column({ type: 'varchar', length: 500 })
  front: string;

  @Column({ type: 'varchar', length: 500 })
  back: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  translation: string | null;

  @Column({ type: 'text', nullable: true })
  example: string | null;

  @Column({ type: 'text', nullable: true })
  personal_example: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  source_name: string | null;

  @Column({ type: 'text', nullable: true })
  source_url: string | null;

  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  level: EnglishLevel | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[];

  @Column({
    type: 'enum',
    enum: FlashcardStatus,
    enumName: 'flashcard_status_enum',
    default: FlashcardStatus.NEW,
  })
  status: FlashcardStatus;

  @Column({ type: 'timestamp with time zone' })
  next_review_at: Date;

  @Column({ type: 'integer', default: 0 })
  interval_minutes: number;

  @Column({ type: 'numeric', precision: 4, scale: 2, default: 2.5 })
  ease_factor: string;

  @Column({ type: 'integer', default: 0 })
  repetitions: number;

  @Column({ type: 'integer', default: 0 })
  lapses: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────
  // NOTA: `deck_id` referencia decks.id como relación simple para queries/joins.
  // La integridad `flashcards.user_id = decks.user_id` la garantiza una FK
  // compuesta (deck_id, user_id) → decks(id, user_id) definida solo en la
  // migración SQL — no existe como relación TypeORM independiente.

  @ManyToOne('User', 'flashcards', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('Deck', 'flashcards', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deck_id' })
  deck: Deck;

  @OneToMany('FlashcardReview', 'flashcard')
  reviews: FlashcardReview[];
}
