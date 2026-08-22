import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { CambridgeKnowledgeItemMetadata } from './cambridge-knowledge-json-types';
import type { CambridgeSource } from './CambridgeSource';

/**
 * One semantic chunk extracted from a CambridgeSource PDF, classified with
 * Cambridge metadata and embedded for semantic search. Always traceable
 * back to its document (source_id) and exact page (source_page) — see
 * "Trazabilidad" in docs/cambridge-knowledge-base.md.
 *
 * `embedding` is stored as JSONB (a plain number[]), not a pgvector column
 * — this app's Postgres has no pgvector extension installed/verified, and a
 * curated, admin-only B2 First corpus is small enough that ranking by
 * cosine similarity in application code (see search-cambridge-knowledge.
 * service.ts) is fast and dependency-free. Revisit if the corpus grows into
 * the tens of thousands of chunks.
 */
@Entity('cambridge_knowledge_items')
export class CambridgeKnowledgeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  source_id: string;

  // Always 'B2_FIRST' today (see TargetExam.B2_FIRST) — kept as a column
  // rather than hardcoded so a future exam never needs a migration, exactly
  // like Practice's examCode/paperCode/partCode (see practice-exam-catalog.ts).
  @Column({ type: 'varchar', length: 50 })
  exam_code: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  paper_code: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  part_code: string | null;

  // Skill slugs (see config/seed/data/skills.ts): 'reading', 'use-of-english',
  // 'writing', 'listening', 'speaking'. Native text[] rather than JSONB — a
  // chunk usually touches 1-2 skills, and `= ANY(skills)` is a plain indexable
  // array containment check.
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  skills: string[];

  // Free-form but constrained to lib/exam-topics.ts's EXAM_TOPICS bank at
  // classification time (see classify-cambridge-chunk.ts) — the same bank
  // Practice/Writing generation already draws on, so Daily Lesson/Practice
  // consumers get one consistent topic vocabulary across the whole app.
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  topics: string[];

  @Column({ type: 'text' })
  content: string;

  // 1-based page number in the source PDF.
  @Column({ type: 'integer' })
  source_page: number;

  // e.g. "Reading Part 5 sample task" — free text, set by the classifier
  // when the page has an identifiable section heading; null when it can't
  // be determined (never invented — see classify-cambridge-chunk.ts).
  @Column({ type: 'varchar', length: 255, nullable: true })
  source_section: string | null;

  // number[] (e.g. 1536 floats for text-embedding-3-small). See the class
  // doc comment for why this is JSONB and not pgvector.
  @Column({ type: 'jsonb' })
  embedding: number[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: CambridgeKnowledgeItemMetadata | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  // ── Relations ──────────────────────────────────────────────────────────────

  @ManyToOne('CambridgeSource', 'items', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_id' })
  source: CambridgeSource;
}
