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
  PracticeItemMetadata,
} from './practice-json-types';
import type { PracticeExercise } from './PracticeExercise';

@Entity('practice_items')
export class PracticeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  exercise_id: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'varchar', length: 50 })
  task_type: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', nullable: true })
  options: PracticeItemOption[] | null;

  // Nunca debe salir en una lectura normal (borrador antes de submit, o
  // exponer la respuesta correcta al cliente). Solo un addSelect() explícito
  // en la consulta interna de evaluación la recupera — ver
  // PracticeExercisesRepository.findExerciseWithAnswerKeysForEvaluation.
  @Column({ type: 'jsonb', select: false })
  answer_key: PracticeItemAnswerKey;

  // Misma razón que answer_key: puede revelar la respuesta correcta.
  @Column({ type: 'text', nullable: true, select: false })
  explanation: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  skill_tags: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: PracticeItemMetadata | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('PracticeExercise', 'items', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exercise_id' })
  exercise: PracticeExercise;
}
