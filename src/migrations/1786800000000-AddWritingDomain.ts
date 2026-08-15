import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWritingDomain1786800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ────────────────────────────────────────────────────────────
    // task_type has its own enum (unlike Practice's exam_code/paper_code/
    // part_code, which are plain varchars validated by the application-level
    // catalog) because Writing has exactly one real-world value for now
    // (essay) and a second, already-known one (situational_writing) — no
    // open-ended catalog to keep flexible. practice_exercise_source_enum and
    // english_level_enum already exist (AddPracticeDomain / CreateInitialSchema)
    // and are reused as-is.

    await queryRunner.query(`CREATE TYPE "writing_task_type_enum" AS ENUM ('essay')`);
    await queryRunner.query(
      `CREATE TYPE "writing_submission_status_enum" AS ENUM ('in_progress', 'graded', 'abandoned')`,
    );

    // ── writing_tasks ────────────────────────────────────────────────────────
    // idempotency_key is included from the start (unlike Practice, which
    // added it in a follow-up migration) — same partial-unique pattern as
    // uq_practice_exercises_user_idempotency: scoped to WHERE deleted_at IS
    // NULL so a soft-deleted task never blocks reusing its key for a new
    // generation.

    await queryRunner.query(`
      CREATE TABLE "writing_tasks" (
        "id"                  UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"             UUID                          NOT NULL,
        "task_type"           "writing_task_type_enum"      NOT NULL,
        "target_level"        "english_level_enum",
        "title"               VARCHAR(255)                  NOT NULL,
        "instructions"        TEXT                          NOT NULL,
        "min_words"           INTEGER                       NOT NULL,
        "max_words"           INTEGER                       NOT NULL,
        "time_limit_seconds"  INTEGER                       NOT NULL,
        "source"              "practice_exercise_source_enum" NOT NULL,
        "model"               VARCHAR(100),
        "prompt_version"      VARCHAR(50),
        "generation_metadata" JSONB,
        "idempotency_key"     UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "created_at"          TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        CONSTRAINT "pk_writing_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "uq_writing_tasks_id_user" UNIQUE ("id", "user_id"),
        CONSTRAINT "fk_writing_tasks_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_writing_tasks_title_not_blank" CHECK (length(trim(both from "title")) > 0),
        CONSTRAINT "chk_writing_tasks_instructions_not_blank" CHECK (length(trim(both from "instructions")) > 0),
        CONSTRAINT "chk_writing_tasks_min_words_positive" CHECK ("min_words" > 0),
        CONSTRAINT "chk_writing_tasks_max_words_ge_min" CHECK ("max_words" >= "min_words"),
        CONSTRAINT "chk_writing_tasks_time_limit_positive" CHECK ("time_limit_seconds" > 0)
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_writing_tasks_user_idempotency" ON "writing_tasks" ("user_id", "idempotency_key") WHERE "deleted_at" IS NULL`,
    );

    // ── writing_submissions ──────────────────────────────────────────────────
    // No item/answer children — one free-text response graded holistically,
    // not N discrete items with answer keys. feedback (jsonb, WritingFeedback
    // shape) carries the 4 criterion bands, corrections, rewritten text and
    // summary once graded.
    //
    // (task_id, user_id) FK: ON DELETE NO ACTION (protects submission
    // history from a task hard-delete) + DEFERRABLE INITIALLY DEFERRED (only
    // postpones when that check runs, to COMMIT) — identical reasoning to
    // practice_attempts -> practice_exercises in AddPracticeDomain.

    await queryRunner.query(`
      CREATE TABLE "writing_submissions" (
        "id"                UUID                              NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID                              NOT NULL,
        "task_id"           UUID                              NOT NULL,
        "status"            "writing_submission_status_enum" NOT NULL DEFAULT 'in_progress',
        "started_at"        TIMESTAMPTZ                       NOT NULL,
        "submitted_at"      TIMESTAMPTZ,
        "duration_seconds"  INTEGER,
        "submitted_text"    TEXT,
        "word_count"        INTEGER,
        "feedback"          JSONB,
        "created_at"        TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMPTZ,
        CONSTRAINT "pk_writing_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_writing_submissions_id_task_user" UNIQUE ("id", "task_id", "user_id"),
        CONSTRAINT "fk_writing_submissions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_writing_submissions_task_user" FOREIGN KEY ("task_id", "user_id")
          REFERENCES "writing_tasks" ("id", "user_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_writing_submissions_duration_nonneg" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
        CONSTRAINT "chk_writing_submissions_word_count_nonneg" CHECK ("word_count" IS NULL OR "word_count" >= 0),
        CONSTRAINT "chk_writing_submissions_submitted_after_started" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at"),
        CONSTRAINT "chk_writing_submissions_in_progress_has_no_result" CHECK (
          "status" <> 'in_progress' OR (
            "submitted_at" IS NULL AND "duration_seconds" IS NULL AND
            "submitted_text" IS NULL AND "word_count" IS NULL AND "feedback" IS NULL
          )
        ),
        CONSTRAINT "chk_writing_submissions_graded_has_result" CHECK (
          "status" <> 'graded' OR (
            "submitted_at" IS NOT NULL AND "duration_seconds" IS NOT NULL AND
            "submitted_text" IS NOT NULL AND "word_count" IS NOT NULL AND "feedback" IS NOT NULL
          )
        )
      )
    `);

    // ── Indexes ────────────────────────────────────────────────────────────────

    await queryRunner.query(
      `CREATE INDEX "idx_writing_tasks_user_created" ON "writing_tasks" ("user_id", "created_at") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_writing_submissions_user_started" ON "writing_submissions" ("user_id", "started_at" DESC) WHERE "deleted_at" IS NULL`,
    );

    // At most one Writing submission in progress per user at a time — same
    // pattern as uq_practice_attempts_one_active_per_user.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_writing_submissions_one_active_per_user" ON "writing_submissions" ("user_id") WHERE "status" = 'in_progress' AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Tablas (orden inverso de dependencias) ──────────────────────────────────

    await queryRunner.query(`DROP TABLE "writing_submissions"`);
    await queryRunner.query(`DROP TABLE "writing_tasks"`);

    // ── Enum types ───────────────────────────────────────────────────────────

    await queryRunner.query(`DROP TYPE "writing_submission_status_enum"`);
    await queryRunner.query(`DROP TYPE "writing_task_type_enum"`);
  }
}
