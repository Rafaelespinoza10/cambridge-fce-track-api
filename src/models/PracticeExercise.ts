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
import { PracticeExerciseSource, EnglishLevel } from './enums';
import type { PracticeExerciseGenerationMetadata } from './practice-json-types';
import type { User } from './User';
import type { PracticeItem } from './PracticeItem';

@Entity('practice_exercises')
export class PracticeExercise {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 50 })
  exam_code: string;

  @Column({ type: 'varchar', length: 50 })
  paper_code: string;

  @Column({ type: 'varchar', length: 50 })
  part_code: string;

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

  @Column({ type: 'text', nullable: true })
  stimulus: string | null;

  @Column({ type: 'integer', nullable: true })
  time_limit_seconds: number | null;

  @Column({ type: 'integer' })
  item_count: number;

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
  generation_metadata: PracticeExerciseGenerationMetadata | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────
  // Unidireccional hacia User (sin inversa en User.ts, por decisión explícita
  // de no agregar más arrays de relaciones a esa entidad).

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany('PracticeItem', 'exercise')
  items: PracticeItem[];
}
