import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailySessionModule1787500000000 implements MigrationInterface {
  name = 'AddDailySessionModule1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ───────────────────────────────────────────────────────────
    // A dedicated source enum rather than reusing practice_exercise_source_enum
    // — same domain-isolation rule this codebase already follows for JSON
    // types (practice-json-types.ts vs writing-json-types.ts never share a
    // type), so a later Practice-only change can't silently affect this table.

    await queryRunner.query(`CREATE TYPE "daily_session_source_enum" AS ENUM ('ai', 'system')`);
    await queryRunner.query(
      `CREATE TYPE "daily_session_submission_status_enum" AS ENUM ('in_progress', 'graded', 'abandoned')`,
    );

    // ── daily_sessions ───────────────────────────────────────────────────────
    //
    // One row per user per calendar day — UNIQUE (user_id, session_date) is
    // the idempotency key (see uq_daily_sessions_user_session_date below),
    // deliberately replacing the client-supplied idempotency_key UUID Practice
    // and Writing use: "daily" is itself a natural, server-derivable key.

    await queryRunner.query(`
      CREATE TABLE "daily_sessions" (
        "id"                          UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                     UUID                          NOT NULL,
        "session_date"                DATE                          NOT NULL,
        "timezone"                    VARCHAR(100)                  NOT NULL,
        "target_level"                "english_level_enum",
        "topic"                       VARCHAR(150)                  NOT NULL,
        "reading_title"               VARCHAR(255)                  NOT NULL,
        "reading_instructions"        TEXT                          NOT NULL,
        "reading_passage"             TEXT                          NOT NULL,
        "item_count"                  INTEGER                       NOT NULL,
        "sentence_task_instructions"  TEXT                          NOT NULL,
        "sentence_targets"            JSONB                         NOT NULL,
        "source"                      "daily_session_source_enum"   NOT NULL,
        "model"                       VARCHAR(100),
        "prompt_version"              VARCHAR(50),
        "generation_metadata"         JSONB,
        "created_at"                  TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "deleted_at"                  TIMESTAMPTZ,
        CONSTRAINT "pk_daily_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_daily_sessions_id_user" UNIQUE ("id", "user_id"),
        CONSTRAINT "fk_daily_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_daily_sessions_timezone_not_blank" CHECK (length(trim(both from "timezone")) > 0),
        CONSTRAINT "chk_daily_sessions_topic_not_blank" CHECK (length(trim(both from "topic")) > 0),
        CONSTRAINT "chk_daily_sessions_reading_title_not_blank" CHECK (length(trim(both from "reading_title")) > 0),
        CONSTRAINT "chk_daily_sessions_reading_instructions_not_blank" CHECK (length(trim(both from "reading_instructions")) > 0),
        CONSTRAINT "chk_daily_sessions_reading_passage_not_blank" CHECK (length(trim(both from "reading_passage")) > 0),
        CONSTRAINT "chk_daily_sessions_sentence_task_instructions_not_blank" CHECK (length(trim(both from "sentence_task_instructions")) > 0),
        CONSTRAINT "chk_daily_sessions_item_count_positive" CHECK ("item_count" > 0)
      )
    `);

    // A partial unique index (not a table CONSTRAINT) because it needs the
    // "WHERE deleted_at IS NULL" predicate — Postgres table-level UNIQUE
    // constraints don't support WHERE clauses, only CREATE UNIQUE INDEX does.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_daily_sessions_user_session_date" ON "daily_sessions" ("user_id", "session_date") WHERE "deleted_at" IS NULL`,
    );

    // ── daily_session_items ──────────────────────────────────────────────────
    //
    // answer_key/explanation carry `select: false` in the entity (TypeORM
    // guard) — this table-level definition is the storage side of that; the
    // app-level guard is what actually keeps them out of normal reads. Same
    // pattern as practice_items.

    await queryRunner.query(`
      CREATE TABLE "daily_session_items" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "daily_session_id"  UUID         NOT NULL,
        "position"          INTEGER      NOT NULL,
        "prompt"            TEXT         NOT NULL,
        "options"           JSONB,
        "answer_key"        JSONB        NOT NULL,
        "explanation"       TEXT,
        "skill_tags"        TEXT[]       NOT NULL DEFAULT '{}',
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_daily_session_items" PRIMARY KEY ("id"),
        CONSTRAINT "uq_daily_session_items_session_position" UNIQUE ("daily_session_id", "position"),
        CONSTRAINT "fk_daily_session_items_session" FOREIGN KEY ("daily_session_id")
          REFERENCES "daily_sessions" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_daily_session_items_position_positive" CHECK ("position" >= 1),
        CONSTRAINT "chk_daily_session_items_prompt_not_blank" CHECK (length(trim(both from "prompt")) > 0)
      )
    `);

    // ── daily_session_submissions ────────────────────────────────────────────
    //
    // Composite FK (daily_session_id, user_id) -> daily_sessions(id, user_id):
    // ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED, same split as
    // practice_attempts -> practice_exercises — NO ACTION protects history
    // (a session can't be hard-deleted out from under a submission that
    // references it), DEFERRABLE INITIALLY DEFERRED only postpones the check
    // to COMMIT so insert order within one transaction doesn't matter.
    //
    // Unlike practice_attempts/writing_submissions there is no plan_day_id
    // column here — Daily Session always registers against the day it's FOR
    // (daily_sessions.session_date), resolved fresh at grade time, so there is
    // nothing ambiguous to capture at start.

    await queryRunner.query(`
      CREATE TABLE "daily_session_submissions" (
        "id"                            UUID                                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                       UUID                                     NOT NULL,
        "daily_session_id"              UUID                                     NOT NULL,
        "status"                        "daily_session_submission_status_enum"  NOT NULL DEFAULT 'in_progress',
        "started_at"                    TIMESTAMPTZ                             NOT NULL,
        "submitted_at"                  TIMESTAMPTZ,
        "duration_seconds"              INTEGER,
        "comprehension_answers"         JSONB,
        "comprehension_correct_count"   INTEGER,
        "comprehension_total_count"     INTEGER,
        "comprehension_percentage"      NUMERIC(5,2),
        "sentence_submissions"          JSONB,
        "sentence_feedback"             JSONB,
        "created_at"                    TIMESTAMPTZ                             NOT NULL DEFAULT now(),
        "updated_at"                    TIMESTAMPTZ                             NOT NULL DEFAULT now(),
        "deleted_at"                    TIMESTAMPTZ,
        CONSTRAINT "pk_daily_session_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_daily_session_submissions_id_session_user" UNIQUE ("id", "daily_session_id", "user_id"),
        CONSTRAINT "fk_daily_session_submissions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_daily_session_submissions_session_user" FOREIGN KEY ("daily_session_id", "user_id")
          REFERENCES "daily_sessions" ("id", "user_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_daily_session_submissions_duration_nonneg" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
        CONSTRAINT "chk_daily_session_submissions_comprehension_correct_nonneg" CHECK ("comprehension_correct_count" IS NULL OR "comprehension_correct_count" >= 0),
        CONSTRAINT "chk_daily_session_submissions_comprehension_correct_le_total" CHECK ("comprehension_correct_count" IS NULL OR "comprehension_total_count" IS NULL OR "comprehension_correct_count" <= "comprehension_total_count"),
        CONSTRAINT "chk_daily_session_submissions_comprehension_percentage_range" CHECK ("comprehension_percentage" IS NULL OR ("comprehension_percentage" >= 0 AND "comprehension_percentage" <= 100)),
        CONSTRAINT "chk_daily_session_submissions_submitted_after_started" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at"),
        CONSTRAINT "chk_daily_session_submissions_in_progress_has_no_result" CHECK (
          "status" <> 'in_progress' OR (
            "submitted_at" IS NULL AND "duration_seconds" IS NULL AND
            "comprehension_answers" IS NULL AND "sentence_submissions" IS NULL AND
            "sentence_feedback" IS NULL
          )
        ),
        CONSTRAINT "chk_daily_session_submissions_graded_has_result" CHECK (
          "status" <> 'graded' OR (
            "submitted_at" IS NOT NULL AND "duration_seconds" IS NOT NULL AND
            "comprehension_answers" IS NOT NULL AND "sentence_submissions" IS NOT NULL AND
            "sentence_feedback" IS NOT NULL
          )
        )
      )
    `);

    // One submission per session — stricter than Practice (which allows
    // multiple attempts per exercise): a calendar day has exactly one
    // generation and exactly one submission.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_daily_session_submissions_session" ON "daily_session_submissions" ("daily_session_id") WHERE "deleted_at" IS NULL`,
    );

    // ── Indexes ──────────────────────────────────────────────────────────────

    await queryRunner.query(
      `CREATE INDEX "idx_daily_sessions_user_created" ON "daily_sessions" ("user_id", "created_at") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_daily_session_submissions_user_created" ON "daily_session_submissions" ("user_id", "created_at") WHERE "deleted_at" IS NULL`,
    );

    // ── planned_activities: third AI-link column ────────────────────────────
    //
    // Extends the two-way XOR added by AddAiLinkedPlannedActivities into a
    // three-way XOR: source = 'ai_generated' now means exactly one of
    // practice_attempt_id / writing_submission_id / daily_session_submission_id
    // is set (never zero, never more than one); source = 'manual' means all
    // three are NULL. ON DELETE SET NULL — losing the submission must not
    // cascade into deleting the plan entry itself. Partial unique index so a
    // submit retry (idempotent replay) can never create a second
    // planned_activity for the same submission.

    await queryRunner.query(`
      ALTER TABLE "planned_activities" ADD COLUMN "daily_session_submission_id" UUID
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD CONSTRAINT "fk_planned_activities_daily_session_submission" FOREIGN KEY ("daily_session_submission_id")
          REFERENCES "daily_session_submissions" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP CONSTRAINT "chk_planned_activities_ai_link"
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD CONSTRAINT "chk_planned_activities_ai_link" CHECK (
          (
            "source" = 'manual' AND "practice_attempt_id" IS NULL AND "writing_submission_id" IS NULL
              AND "daily_session_submission_id" IS NULL
          )
          OR (
            "source" = 'ai_generated' AND (
              ("practice_attempt_id" IS NOT NULL AND "writing_submission_id" IS NULL AND "daily_session_submission_id" IS NULL)
              OR ("practice_attempt_id" IS NULL AND "writing_submission_id" IS NOT NULL AND "daily_session_submission_id" IS NULL)
              OR ("practice_attempt_id" IS NULL AND "writing_submission_id" IS NULL AND "daily_session_submission_id" IS NOT NULL)
            )
          )
        )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_planned_activities_daily_session_submission" ON "planned_activities" ("daily_session_submission_id") WHERE "daily_session_submission_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── planned_activities: restore the original two-way XOR ───────────────

    await queryRunner.query(`DROP INDEX "uq_planned_activities_daily_session_submission"`);

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP CONSTRAINT "chk_planned_activities_ai_link"
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD CONSTRAINT "chk_planned_activities_ai_link" CHECK (
          ("source" = 'manual' AND "practice_attempt_id" IS NULL AND "writing_submission_id" IS NULL)
          OR (
            "source" = 'ai_generated' AND (
              ("practice_attempt_id" IS NOT NULL AND "writing_submission_id" IS NULL)
              OR ("practice_attempt_id" IS NULL AND "writing_submission_id" IS NOT NULL)
            )
          )
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP CONSTRAINT "fk_planned_activities_daily_session_submission"
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP COLUMN "daily_session_submission_id"
    `);

    // ── Tables (reverse dependency order) ───────────────────────────────────

    await queryRunner.query(`DROP TABLE "daily_session_submissions"`);
    await queryRunner.query(`DROP TABLE "daily_session_items"`);
    await queryRunner.query(`DROP TABLE "daily_sessions"`);

    // ── Enum types ───────────────────────────────────────────────────────────

    await queryRunner.query(`DROP TYPE "daily_session_submission_status_enum"`);
    await queryRunner.query(`DROP TYPE "daily_session_source_enum"`);
  }
}
