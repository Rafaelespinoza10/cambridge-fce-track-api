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
import { StudySessionType, StudySessionStatus } from './enums';
import type { User } from './User';
import type { PlannedActivity } from './PlannedActivity';
import type { FlashcardReview } from './FlashcardReview';

@Entity('study_sessions')
export class StudySession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  planned_activity_id: string | null;

  @Column({
    type: 'enum',
    enum: StudySessionType,
    enumName: 'study_session_type_enum',
    default: StudySessionType.ACTIVITY,
  })
  session_type: StudySessionType;

  @Column({
    type: 'enum',
    enum: StudySessionStatus,
    enumName: 'study_session_status_enum',
    default: StudySessionStatus.ACTIVE,
  })
  status: StudySessionStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  ended_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  duration_minutes: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────
  // NOTA: la integridad `flashcard_reviews.user_id = study_sessions.user_id` la
  // garantiza una FK compuesta (study_session_id, user_id) → study_sessions(id,
  // user_id) definida solo en la migración SQL, no como relación TypeORM.

  @ManyToOne('User', 'study_sessions', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('PlannedActivity', 'study_sessions', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'planned_activity_id' })
  planned_activity: PlannedActivity | null;

  @OneToMany('FlashcardReview', 'study_session')
  flashcard_reviews: FlashcardReview[];
}
