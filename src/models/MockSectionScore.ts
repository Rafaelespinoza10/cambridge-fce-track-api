import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { MockTest } from './MockTest';
import type { Skill } from './Skill';

@Entity('mock_section_scores')
export class MockSectionScore {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  mock_test_id: string;

  @Column({ type: 'uuid', nullable: true })
  skill_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  section_name: string;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  raw_score: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  max_score: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  percentage: string | null;

  @Column({ type: 'integer', nullable: true })
  cambridge_score: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('MockTest', 'section_scores', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mock_test_id' })
  mock_test: MockTest;

  @ManyToOne('Skill', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill | null;
}
