import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * listening_attempts — a student's own attempt against an admin-curated
 * ListeningSource (see AddFullMockAttemptsAndListening.ts for that table).
 * Deliberately lean compared to practice_attempts/practice_answers:
 * ListeningSource content is static and reusable (no scarcity, no AI cost
 * to regenerate), so there is no "one active attempt" constraint — a user
 * can start as many attempts against the same source as they like — and
 * graded answers are stored inline as JSONB on the attempt row rather than
 * a separate child table, since nothing here needs a per-answer FK join
 * (no Mistake Bank integration for this MVP).
 */
export class AddListeningAttempts1788100000000 implements MigrationInterface {
  name = 'AddListeningAttempts1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "listening_attempt_status_enum" AS ENUM ('in_progress', 'completed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "listening_attempts" (
        "id"                UUID                             NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID                             NOT NULL,
        "source_id"         UUID                             NOT NULL,
        "status"            "listening_attempt_status_enum"  NOT NULL DEFAULT 'in_progress',
        "started_at"        TIMESTAMPTZ                      NOT NULL,
        "submitted_at"      TIMESTAMPTZ,
        "duration_seconds"  INTEGER,
        "correct_count"     INTEGER,
        "total_count"       INTEGER                          NOT NULL,
        "percentage"        NUMERIC(5,2),
        "answers"           JSONB,
        "feedback_summary"  JSONB,
        "created_at"        TIMESTAMPTZ                      NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ                      NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMPTZ,
        CONSTRAINT "pk_listening_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_listening_attempts_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_listening_attempts_source" FOREIGN KEY ("source_id")
          REFERENCES "listening_sources" ("id") ON DELETE NO ACTION,
        CONSTRAINT "chk_listening_attempts_total_count_positive" CHECK ("total_count" > 0),
        CONSTRAINT "chk_listening_attempts_duration_nonneg" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
        CONSTRAINT "chk_listening_attempts_correct_count_nonneg" CHECK ("correct_count" IS NULL OR "correct_count" >= 0),
        CONSTRAINT "chk_listening_attempts_correct_le_total" CHECK ("correct_count" IS NULL OR "correct_count" <= "total_count"),
        CONSTRAINT "chk_listening_attempts_percentage_range" CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100)),
        CONSTRAINT "chk_listening_attempts_submitted_after_started" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at"),
        CONSTRAINT "chk_listening_attempts_in_progress_has_no_result" CHECK (
          "status" <> 'in_progress' OR (
            "submitted_at" IS NULL AND "duration_seconds" IS NULL AND
            "correct_count" IS NULL AND "percentage" IS NULL AND "answers" IS NULL
          )
        ),
        CONSTRAINT "chk_listening_attempts_completed_has_result" CHECK (
          "status" <> 'completed' OR (
            "submitted_at" IS NOT NULL AND "duration_seconds" IS NOT NULL AND
            "correct_count" IS NOT NULL AND "percentage" IS NOT NULL AND "answers" IS NOT NULL
          )
        )
      )
    `);

    // "Mi historial de listening" y la fuente de unified_scores (ver
    // UNIFIED_SCORES_CTE en progress.repository.ts).
    await queryRunner.query(
      `CREATE INDEX "idx_listening_attempts_user_started" ON "listening_attempts" ("user_id", "started_at" DESC) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_listening_attempts_source" ON "listening_attempts" ("source_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_listening_attempts_source"`);
    await queryRunner.query(`DROP INDEX "idx_listening_attempts_user_started"`);
    await queryRunner.query(`DROP TABLE "listening_attempts"`);
    await queryRunner.query(`DROP TYPE "listening_attempt_status_enum"`);
  }
}
