import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cambridge Knowledge Base — a global, admin-managed corpus of B2 First
 * material (see docs/cambridge-knowledge-base.md). Two tables:
 *
 * - cambridge_sources: one row per imported PDF. `checksum` (sha256 of the
 *   raw bytes) is UNIQUE, which is what makes ImportCambridgeKnowledgeService
 *   idempotent — re-importing the same file is a no-op instead of a
 *   duplicate row.
 * - cambridge_knowledge_items: one row per semantic chunk, always traceable
 *   back to its source and exact page (source_id, source_page — never
 *   nullable), classified with Cambridge metadata and embedded for semantic
 *   search.
 *
 * No FK to `users` anywhere in this migration — the Knowledge Base is
 * global, not user-owned (see the "Seguridad" section of the docs).
 */
export class AddCambridgeKnowledgeBase1787300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ────────────────────────────────────────────────────────────

    await queryRunner.query(
      `CREATE TYPE "cambridge_source_status_enum" AS ENUM ('active', 'inactive')`,
    );

    // ── cambridge_sources ────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "cambridge_sources" (
        "id"          UUID                              NOT NULL DEFAULT gen_random_uuid(),
        "name"        VARCHAR(255)                      NOT NULL,
        "description" TEXT,
        "version"     VARCHAR(50)                        NOT NULL,
        "status"      "cambridge_source_status_enum"     NOT NULL DEFAULT 'active',
        "checksum"    VARCHAR(64)                        NOT NULL,
        "page_count"  INTEGER                            NOT NULL,
        "created_at"  TIMESTAMPTZ                        NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ                        NOT NULL DEFAULT now(),
        CONSTRAINT "pk_cambridge_sources" PRIMARY KEY ("id"),
        CONSTRAINT "uq_cambridge_sources_checksum" UNIQUE ("checksum"),
        CONSTRAINT "chk_cambridge_sources_name_not_blank" CHECK (length(trim(both from "name")) > 0),
        CONSTRAINT "chk_cambridge_sources_version_not_blank" CHECK (length(trim(both from "version")) > 0),
        CONSTRAINT "chk_cambridge_sources_checksum_sha256" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
        CONSTRAINT "chk_cambridge_sources_page_count_positive" CHECK ("page_count" > 0)
      )
    `);

    // ── cambridge_knowledge_items ────────────────────────────────────────────
    // (source_id, source_page) is NOT unique — a single page routinely
    // yields several chunks (see cambridge-chunker.ts). skills/topics are
    // plain `text[]`, not JSONB, so `= ANY(...)` / `&&` stay simple indexable
    // array operators for SearchCambridgeKnowledgeService's metadata filters.

    await queryRunner.query(`
      CREATE TABLE "cambridge_knowledge_items" (
        "id"             UUID          NOT NULL DEFAULT gen_random_uuid(),
        "source_id"      UUID          NOT NULL,
        "exam_code"      VARCHAR(50)   NOT NULL,
        "paper_code"     VARCHAR(50),
        "part_code"      VARCHAR(50),
        "skills"         TEXT[]        NOT NULL DEFAULT '{}',
        "topics"         TEXT[]        NOT NULL DEFAULT '{}',
        "content"        TEXT          NOT NULL,
        "source_page"    INTEGER       NOT NULL,
        "source_section" VARCHAR(255),
        "embedding"      JSONB         NOT NULL,
        "metadata"       JSONB,
        "created_at"     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_cambridge_knowledge_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_cambridge_knowledge_items_source" FOREIGN KEY ("source_id")
          REFERENCES "cambridge_sources" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_cambridge_knowledge_items_content_not_blank" CHECK (length(trim(both from "content")) > 0),
        CONSTRAINT "chk_cambridge_knowledge_items_source_page_positive" CHECK ("source_page" > 0),
        CONSTRAINT "chk_cambridge_knowledge_items_exam_code_not_blank" CHECK (length(trim(both from "exam_code")) > 0)
      )
    `);

    // ── Indexes ────────────────────────────────────────────────────────────────

    await queryRunner.query(
      `CREATE INDEX "idx_cambridge_knowledge_items_source" ON "cambridge_knowledge_items" ("source_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cambridge_knowledge_items_paper_part" ON "cambridge_knowledge_items" ("exam_code", "paper_code", "part_code")`,
    );
    // GIN indexes so the "skill"/"topic" filters in SearchCambridgeKnowledgeService
    // (`skills @> ARRAY[:skill]`, `topics @> ARRAY[:topic]`) can use an index
    // instead of a full scan as the corpus grows.
    await queryRunner.query(
      `CREATE INDEX "idx_cambridge_knowledge_items_skills" ON "cambridge_knowledge_items" USING GIN ("skills")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cambridge_knowledge_items_topics" ON "cambridge_knowledge_items" USING GIN ("topics")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Tablas (orden inverso de dependencias) ──────────────────────────────────

    await queryRunner.query(`DROP TABLE "cambridge_knowledge_items"`);
    await queryRunner.query(`DROP TABLE "cambridge_sources"`);

    // ── Enum types ───────────────────────────────────────────────────────────

    await queryRunner.query(`DROP TYPE "cambridge_source_status_enum"`);
  }
}
