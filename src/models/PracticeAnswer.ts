import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { PracticeAnswerPayload, PracticeAnswerFeedback } from './practice-json-types';
import type { User } from './User';
import type { PracticeExercise } from './PracticeExercise';
import type { PracticeAttempt } from './PracticeAttempt';
import type { PracticeItem } from './PracticeItem';

@Entity('practice_answers')
export class PracticeAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  exercise_id: string;

  @Column({ type: 'uuid' })
  attempt_id: string;

  @Column({ type: 'uuid' })
  item_id: string;

  @Column({ type: 'jsonb' })
  answer_payload: PracticeAnswerPayload;

  @Column({ type: 'text', nullable: true })
  normalized_answer: string | null;

  @Column({ type: 'boolean' })
  is_correct: boolean;

  @Column({ type: 'integer', nullable: true })
  response_time_ms: number | null;

  @Column({ type: 'jsonb', nullable: true })
  feedback: PracticeAnswerFeedback | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  // NOTA: exercise_id/attempt_id/item_id son relaciones simples para
  // queries/joins. La integridad compuesta —
  //   practice_answers(attempt_id, exercise_id, user_id)
  //     -> practice_attempts(id, exercise_id, user_id)
  //   practice_answers(item_id, exercise_id) -> practice_items(id, exercise_id)
  // — la garantizan dos FKs compuestas definidas solo en la migracion SQL.
  // Ambas son ON DELETE NO ACTION (protege el historial de respuestas de un
  // hard-delete de attempt/item) y DEFERRABLE INITIALLY DEFERRED (aplaza
  // cuándo se valida esa FK al COMMIT; no protege nada por si sola). Mismo
  // motivo que PracticeAttempt -> PracticeExercise.

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('PracticeExercise')
  @JoinColumn({ name: 'exercise_id' })
  exercise: PracticeExercise;

  @ManyToOne('PracticeAttempt')
  @JoinColumn({ name: 'attempt_id' })
  attempt: PracticeAttempt;

  @ManyToOne('PracticeItem')
  @JoinColumn({ name: 'item_id' })
  item: PracticeItem;
}
