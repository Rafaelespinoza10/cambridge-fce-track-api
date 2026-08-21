import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { CambridgeSourceStatus } from './enums';
import type { CambridgeKnowledgeItem } from './CambridgeKnowledgeItem';

/**
 * One imported Cambridge PDF (e.g. an official B2 First Handbook or past
 * paper). Global and admin-managed — never owned by a user, never uploaded
 * by a student (see docs/cambridge-knowledge-base.md). `checksum` is the
 * sha256 of the raw PDF bytes and is what ImportCambridgeKnowledgeService
 * uses to make re-importing the same file a no-op (see the unique index in
 * the AddCambridgeKnowledgeBase migration).
 */
@Entity('cambridge_sources')
export class CambridgeSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 50 })
  version: string;

  @Column({
    type: 'enum',
    enum: CambridgeSourceStatus,
    enumName: 'cambridge_source_status_enum',
    default: CambridgeSourceStatus.ACTIVE,
  })
  status: CambridgeSourceStatus;

  // sha256 hex digest (64 chars) of the raw PDF bytes — unique, so the same
  // file can never be imported twice (see ImportCambridgeKnowledgeService).
  @Column({ type: 'varchar', length: 64 })
  checksum: string;

  @Column({ type: 'integer' })
  page_count: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToMany('CambridgeKnowledgeItem', 'source')
  items: CambridgeKnowledgeItem[];
}
