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
import { ExamType, MockType, EnglishLevel } from './enums';
import type { User } from './User';
import type { MockSectionScore } from './MockSectionScore';
import type { EvidenceFile } from './EvidenceFile';

@Entity('mock_tests')
export class MockTest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: ExamType,
    enumName: 'exam_type_enum',
  })
  exam_type: ExamType;

  @Column({
    type: 'enum',
    enum: MockType,
    enumName: 'mock_type_enum',
  })
  mock_type: MockType;

  @Column({ type: 'timestamp with time zone', nullable: true })
  taken_at: Date | null;

  @Column({ type: 'integer', nullable: true })
  estimated_cambridge_score: number | null;

  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  estimated_level: EnglishLevel | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'mock_tests', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany('MockSectionScore', 'mock_test')
  section_scores: MockSectionScore[];

  @OneToMany('EvidenceFile', 'mock_test')
  evidence_files: EvidenceFile[];
}
