import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ListeningSourceStatus, EnglishLevel } from './enums';
import type { ListeningItem } from './ListeningItem';

/**
 * One admin-curated real B2 First Listening test: a real official YouTube
 * video plus the test's real published questions/answer key, entered once by
 * an admin (see adminListeningSourcesController.ts) and reused by every
 * student's timed mock attempt afterward. Global, not owned by any
 * individual user — same trust model as CambridgeSource.
 */
@Entity('listening_sources')
export class ListeningSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  exam_code: string;

  @Column({ type: 'varchar', length: 50 })
  paper_code: string;

  @Column({ type: 'varchar', length: 50 })
  part_code: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  instructions: string;

  @Column({
    type: 'enum',
    enum: EnglishLevel,
    enumName: 'english_level_enum',
    nullable: true,
  })
  target_level: EnglishLevel | null;

  @Column({ type: 'varchar', length: 20, default: 'youtube' })
  video_provider: string;

  @Column({ type: 'varchar', length: 64 })
  video_external_id: string;

  @Column({ type: 'integer' })
  video_start_seconds: number;

  @Column({ type: 'integer' })
  video_end_seconds: number;

  @Column({
    type: 'enum',
    enum: ListeningSourceStatus,
    enumName: 'listening_source_status_enum',
    default: ListeningSourceStatus.ACTIVE,
  })
  status: ListeningSourceStatus;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @OneToMany('ListeningItem', 'source')
  items: ListeningItem[];
}
