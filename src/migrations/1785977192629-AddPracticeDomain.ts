import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPracticeDomain1785977192629 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ────────────────────────────────────────────────────────────
    // Only the internal, stable states get a Postgres enum. exam_code/
    // paper_code/part_code/task_type are plain varchars validated by the
    // application-level catalog (src/lib/practice-exam-catalog.ts) — a new
    // exam or part never needs a migration.

    await queryRunner.query(`CREATE TYPE "practice_exercise_source_enum" AS ENUM ('ai', 'system')`);
    await queryRunner.query(
      `CREATE TYPE "practice_attempt_status_enum" AS ENUM ('in_progress', 'completed', 'abandoned')`,
    );

    // ── practice_exercises ──────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "practice_exercises" (
        "id"                  UUID                              NOT NULL DEFAULT gen_random_uuid(),
        "user_id"             UUID                              NOT NULL,
        "exam_code"           VARCHAR(50)                       NOT NULL,
        "paper_code"          VARCHAR(50)                       NOT NULL,
        "part_code"           VARCHAR(50)                       NOT NULL,
        "target_level"        "english_level_enum",
        "title"               VARCHAR(255)                      NOT NULL,
        "instructions"        TEXT                              NOT NULL,
        "stimulus"            TEXT,
        "time_limit_seconds"  INTEGER,
        "item_count"          INTEGER                           NOT NULL,
        "source"              "practice_exercise_source_enum"   NOT NULL,
        "model"               VARCHAR(100),
        "prompt_version"      VARCHAR(50),
        "generation_metadata" JSONB,
        "created_at"          TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        CONSTRAINT "pk_practice_exercises" PRIMARY KEY ("id"),
        CONSTRAINT "uq_practice_exercises_id_user" UNIQUE ("id", "user_id"),
        CONSTRAINT "fk_practice_exercises_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_practice_exercises_title_not_blank" CHECK (length(trim(both from "title")) > 0),
        CONSTRAINT "chk_practice_exercises_instructions_not_blank" CHECK (length(trim(both from "instructions")) > 0),
        CONSTRAINT "chk_practice_exercises_item_count_positive" CHECK ("item_count" > 0),
        CONSTRAINT "chk_practice_exercises_time_limit_positive" CHECK ("time_limit_seconds" IS NULL OR "time_limit_seconds" > 0)
      )
    `);

    // ── practice_items ───────────────────────────────────────────────────────
    //
    // answer_key/explanation carry `select: false` in the entity (TypeORM
    // guard) — this table-level definition is the storage side of that; the
    // app-level guard is what actually keeps them out of normal reads.

    await queryRunner.query(`
      CREATE TABLE "practice_items" (
        "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "exercise_id" UUID         NOT NULL,
        "position"    INTEGER      NOT NULL,
        "task_type"   VARCHAR(50)  NOT NULL,
        "prompt"      TEXT         NOT NULL,
        "options"     JSONB,
        "answer_key"  JSONB        NOT NULL,
        "explanation" TEXT,
        "skill_tags"  TEXT[]       NOT NULL DEFAULT '{}',
        "metadata"    JSONB,
        "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_practice_items" PRIMARY KEY ("id"),
        CONSTRAINT "uq_practice_items_id_exercise" UNIQUE ("id", "exercise_id"),
        CONSTRAINT "uq_practice_items_exercise_position" UNIQUE ("exercise_id", "position"),
        CONSTRAINT "fk_practice_items_exercise" FOREIGN KEY ("exercise_id")
          REFERENCES "practice_exercises" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_practice_items_position_positive" CHECK ("position" >= 1),
        CONSTRAINT "chk_practice_items_prompt_not_blank" CHECK (length(trim(both from "prompt")) > 0),
        CONSTRAINT "chk_practice_items_task_type_not_blank" CHECK (length(trim(both from "task_type")) > 0)
      )
    `);

    // ── practice_attempts ────────────────────────────────────────────────────
    //
    // exercise_id/user_id FK: ON DELETE NO ACTION (not CASCADE), DEFERRABLE
    // INITIALLY DEFERRED. These are two independent things:
    //   - NO ACTION is what protects history: it makes Postgres REJECT an
    //     exercise hard delete while attempts still reference it, instead of
    //     silently cascading the delete into attempts (per-domain rule "no
    //     cascadas que eliminen historial accidentalmente"). Same pattern as
    //     flashcard_reviews -> flashcards in the flashcards migration.
    //   - DEFERRABLE INITIALLY DEFERRED only changes WHEN that check runs —
    //     at COMMIT instead of immediately after each statement — so a
    //     transaction can insert an attempt and its exercise (or a batch of
    //     rows) without caring about statement order. It grants no
    //     protection by itself: verified empirically (docker/postgres:16,
    //     see PR description) that inserting a practice_answers row before
    //     its practice_attempts parent exists succeeds mid-transaction but
    //     the COMMIT still fails if that parent never shows up.
    // Exercise hard deletes only happen via account purge / admin cleanup /
    // test rollback in this domain — there is no user-facing hard delete.

    await queryRunner.query(`
      CREATE TABLE "practice_attempts" (
        "id"                UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID                          NOT NULL,
        "exercise_id"       UUID                          NOT NULL,
        "status"            "practice_attempt_status_enum" NOT NULL DEFAULT 'in_progress',
        "started_at"        TIMESTAMPTZ                   NOT NULL,
        "submitted_at"      TIMESTAMPTZ,
        "duration_seconds"  INTEGER,
        "correct_count"     INTEGER,
        "total_count"       INTEGER                       NOT NULL,
        "percentage"        NUMERIC(5,2),
        "feedback_summary"  JSONB,
        "created_at"        TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "deleted_at"        TIMESTAMPTZ,
        CONSTRAINT "pk_practice_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "uq_practice_attempts_id_exercise_user" UNIQUE ("id", "exercise_id", "user_id"),
        CONSTRAINT "fk_practice_attempts_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_practice_attempts_exercise_user" FOREIGN KEY ("exercise_id", "user_id")
          REFERENCES "practice_exercises" ("id", "user_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_practice_attempts_total_count_positive" CHECK ("total_count" > 0),
        CONSTRAINT "chk_practice_attempts_duration_nonneg" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0),
        CONSTRAINT "chk_practice_attempts_correct_count_nonneg" CHECK ("correct_count" IS NULL OR "correct_count" >= 0),
        CONSTRAINT "chk_practice_attempts_correct_le_total" CHECK ("correct_count" IS NULL OR "correct_count" <= "total_count"),
        CONSTRAINT "chk_practice_attempts_percentage_range" CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100)),
        CONSTRAINT "chk_practice_attempts_submitted_after_started" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at"),
        CONSTRAINT "chk_practice_attempts_in_progress_has_no_result" CHECK (
          "status" <> 'in_progress' OR (
            "submitted_at" IS NULL AND "duration_seconds" IS NULL AND
            "correct_count" IS NULL AND "percentage" IS NULL
          )
        ),
        CONSTRAINT "chk_practice_attempts_completed_has_result" CHECK (
          "status" <> 'completed' OR (
            "submitted_at" IS NOT NULL AND "duration_seconds" IS NOT NULL AND
            "correct_count" IS NOT NULL AND "percentage" IS NOT NULL
          )
        )
      )
    `);

    // ── practice_answers (log inmutable) ────────────────────────────────────────
    //
    // Both composite FKs: ON DELETE NO ACTION / DEFERRABLE INITIALLY DEFERRED
    // — same split as practice_attempts above. NO ACTION is the protection
    // (an answer can't disappear just because its attempt/item got
    // hard-deleted through an unrelated path); DEFERRABLE INITIALLY DEFERRED
    // only postpones the check to COMMIT.

    await queryRunner.query(`
      CREATE TABLE "practice_answers" (
        "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"           UUID         NOT NULL,
        "exercise_id"       UUID         NOT NULL,
        "attempt_id"        UUID         NOT NULL,
        "item_id"           UUID         NOT NULL,
        "answer_payload"    JSONB        NOT NULL,
        "normalized_answer" TEXT,
        "is_correct"        BOOLEAN      NOT NULL,
        "response_time_ms"  INTEGER,
        "feedback"          JSONB,
        "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_practice_answers" PRIMARY KEY ("id"),
        CONSTRAINT "uq_practice_answers_attempt_item" UNIQUE ("attempt_id", "item_id"),
        CONSTRAINT "fk_practice_answers_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_practice_answers_attempt_exercise_user" FOREIGN KEY ("attempt_id", "exercise_id", "user_id")
          REFERENCES "practice_attempts" ("id", "exercise_id", "user_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "fk_practice_answers_item_exercise" FOREIGN KEY ("item_id", "exercise_id")
          REFERENCES "practice_items" ("id", "exercise_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_practice_answers_response_time_nonneg" CHECK ("response_time_ms" IS NULL OR "response_time_ms" >= 0)
      )
    `);

    // ── Indexes ────────────────────────────────────────────────────────────────
    // Each index maps to a real query from this PR's repositories. No
    // redundant index is added where a UNIQUE constraint's implicit index
    // already covers the same left-prefix (practice_items' (exercise_id,
    // position) unique, practice_answers' (attempt_id, item_id) unique).

    // "Mi historial de ejercicios" y "ejercicios de tal examen" (findByIdForUser
    // no lo necesita — busca por PK — pero un listado futuro sí).
    await queryRunner.query(
      `CREATE INDEX "idx_practice_exercises_user_created" ON "practice_exercises" ("user_id", "created_at") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_practice_exercises_user_exam" ON "practice_exercises" ("user_id", "exam_code") WHERE "deleted_at" IS NULL`,
    );

    // "Historial de intentos del usuario" — PracticeAttemptsRepository.listHistoryByUser.
    await queryRunner.query(
      `CREATE INDEX "idx_practice_attempts_user_started" ON "practice_attempts" ("user_id", "started_at" DESC) WHERE "deleted_at" IS NULL`,
    );

    // A lo sumo un intento de Practice en progreso por usuario (MVP: sin
    // reanudación todavía, pero la constraint ya deja la puerta abierta).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_practice_attempts_one_active_per_user" ON "practice_attempts" ("user_id") WHERE "status" = 'in_progress' AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Tablas (orden inverso de dependencias) ──────────────────────────────────

    await queryRunner.query(`DROP TABLE "practice_answers"`);
    await queryRunner.query(`DROP TABLE "practice_attempts"`);
    await queryRunner.query(`DROP TABLE "practice_items"`);
    await queryRunner.query(`DROP TABLE "practice_exercises"`);

    // ── Enum types ───────────────────────────────────────────────────────────

    await queryRunner.query(`DROP TYPE "practice_attempt_status_enum"`);
    await queryRunner.query(`DROP TYPE "practice_exercise_source_enum"`);
  }
}
