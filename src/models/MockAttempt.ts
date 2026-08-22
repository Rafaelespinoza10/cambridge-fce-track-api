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
import { ExamType, MockAttemptStatus } from './enums';
import type { User } from './User';
import type { MockAttemptSection } from './MockAttemptSection';

/**
 * One live, timed run of a full mock exam. Pre-creates one
 * MockAttemptSection per non-Speaking MOCK_EXAM_CATALOG section on start;
 * on submit, aggregates section scores into a real MockTest +
 * MockSectionScore rows (result_mock_test_id) via the existing
 * MocksRepository — the finished attempt then shows up in the ordinary
 * Mocks history/charts with zero changes to that module.
 */
@Entity('mock_attempts')
export class MockAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({
    type: 'enum',
    enum: ExamType,
    enumName: 'exam_type_enum',
  })
  exam_type: ExamType;

  @Column({
    type: 'enum',
    enum: MockAttemptStatus,
    enumName: 'mock_attempt_status_enum',
    default: MockAttemptStatus.IN_PROGRESS,
  })
  status: MockAttemptStatus;

  @Column({ type: 'timestamp with time zone' })
  started_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  submitted_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  result_mock_test_id: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User')
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany('MockAttemptSection', 'attempt')
  sections: MockAttemptSection[];
}
