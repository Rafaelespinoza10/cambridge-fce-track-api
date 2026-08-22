import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MockAttemptSectionStatus, MockAttemptSectionContentType } from './enums';
import type {
  MockAttemptSectionAnswers,
  MockAttemptSectionGradingFeedback,
} from './mock-attempt-json-types';
import type { MockAttempt } from './MockAttempt';

/**
 * One section (Cambridge exam part) of a MockAttempt — pre-created as
 * 'pending' when the attempt starts, for every non-Speaking
 * MOCK_EXAM_CATALOG section code. Exactly one of practice_exercise_id /
 * writing_task_id / listening_source_id is set once the section moves past
 * 'pending' (see the DB check constraint mirroring content_type).
 */
@Entity('mock_attempt_sections')
export class MockAttemptSection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  mock_attempt_id: string;

  @Column({ type: 'varchar', length: 100 })
  section_code: string;

  @Column({
    type: 'enum',
    enum: MockAttemptSectionContentType,
    enumName: 'mock_attempt_section_content_type_enum',
  })
  content_type: MockAttemptSectionContentType;

  @Column({ type: 'uuid', nullable: true })
  practice_exercise_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  writing_task_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  listening_source_id: string | null;

  @Column({
    type: 'enum',
    enum: MockAttemptSectionStatus,
    enumName: 'mock_attempt_section_status_enum',
    default: MockAttemptSectionStatus.PENDING,
  })
  status: MockAttemptSectionStatus;

  @Column({ type: 'integer' })
  time_limit_seconds: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  answers: MockAttemptSectionAnswers | [];

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  raw_score: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  max_score: string | null;

  @Column({ type: 'jsonb', nullable: true })
  grading_feedback: MockAttemptSectionGradingFeedback | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('MockAttempt', 'sections', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mock_attempt_id' })
  attempt: MockAttempt;
}
