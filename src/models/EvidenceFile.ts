import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StorageProvider } from './enums';
import type { User } from './User';
import type { PlannedActivity } from './PlannedActivity';
import type { ActivityScore } from './ActivityScore';
import type { MockTest } from './MockTest';

@Entity('evidence_files')
export class EvidenceFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  planned_activity_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  activity_score_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  mock_test_id: string | null;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  original_file_name: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  mime_type: string | null;

  @Column({ type: 'integer', nullable: true })
  file_size: number | null;

  @Column({
    type: 'enum',
    enum: StorageProvider,
    enumName: 'storage_provider_enum',
    default: StorageProvider.S3,
  })
  storage_provider: StorageProvider;

  @Column({ type: 'varchar', length: 1024 })
  storage_key: string;

  @Column({ type: 'text', nullable: true })
  public_url: string | null;

  @Column({ type: 'timestamp with time zone' })
  uploaded_at: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp with time zone' })
  deleted_at: Date | null;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('User', 'evidence_files', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne('PlannedActivity', 'evidence_files', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'planned_activity_id' })
  planned_activity: PlannedActivity | null;

  @ManyToOne('ActivityScore', 'evidence_files', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'activity_score_id' })
  activity_score: ActivityScore | null;

  @ManyToOne('MockTest', 'evidence_files', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'mock_test_id' })
  mock_test: MockTest | null;
}
