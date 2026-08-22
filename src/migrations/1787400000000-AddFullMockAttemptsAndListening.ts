import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFullMockAttemptsAndListening1787400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ───────────────────────────────────────────────────────────
    // exam_type_enum and english_level_enum already exist (CreateInitialSchema /
    // AddPracticeDomain) and are reused as-is — no new exam/level enum here.

    await queryRunner.query(
      `CREATE TYPE "listening_source_status_enum" AS ENUM ('active', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TYPE "mock_attempt_status_enum" AS ENUM ('in_progress', 'completed', 'abandoned')`,
    );
    await queryRunner.query(
      `CREATE TYPE "mock_attempt_section_status_enum" AS ENUM ('pending', 'in_progress', 'completed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "mock_attempt_section_content_type_enum" AS ENUM ('practice_exercise', 'writing_task', 'listening')`,
    );

    // ── listening_sources ────────────────────────────────────────────────────
    // Admin-curated, global content — same trust model as cambridge_sources
    // (see docs/cambridge-knowledge-base.md §3: "No user_id anywhere ... the
    // Knowledge Base is global, not owned by any individual user"). A real
    // official YouTube Listening test, registered once by an admin, is
    // reusable by every student's mock attempt. Nothing here is AI-generated.

    await queryRunner.query(`
      CREATE TABLE "listening_sources" (
        "id"                  UUID                              NOT NULL DEFAULT gen_random_uuid(),
        "exam_code"           VARCHAR(50)                       NOT NULL,
        "paper_code"          VARCHAR(50)                       NOT NULL,
        "part_code"           VARCHAR(50)                       NOT NULL,
        "title"               VARCHAR(255)                      NOT NULL,
        "instructions"        TEXT                              NOT NULL,
        "target_level"        "english_level_enum",
        "video_provider"      VARCHAR(20)                       NOT NULL DEFAULT 'youtube',
        "video_external_id"   VARCHAR(64)                       NOT NULL,
        "video_start_seconds" INTEGER                           NOT NULL,
        "video_end_seconds"   INTEGER                           NOT NULL,
        "status"              "listening_source_status_enum"    NOT NULL DEFAULT 'active',
        "created_at"          TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ                       NOT NULL DEFAULT now(),
        CONSTRAINT "pk_listening_sources" PRIMARY KEY ("id"),
        CONSTRAINT "chk_listening_sources_title_not_blank" CHECK (length(trim(both from "title")) > 0),
        CONSTRAINT "chk_listening_sources_instructions_not_blank" CHECK (length(trim(both from "instructions")) > 0),
        CONSTRAINT "chk_listening_sources_video_external_id_not_blank" CHECK (length(trim(both from "video_external_id")) > 0),
        CONSTRAINT "chk_listening_sources_video_start_nonneg" CHECK ("video_start_seconds" >= 0),
        CONSTRAINT "chk_listening_sources_video_end_after_start" CHECK ("video_end_seconds" > "video_start_seconds")
      )
    `);

    // ── listening_items ──────────────────────────────────────────────────────
    // Deliberately mirrors practice_items' shape column-for-column (prompt/
    // options/answer_key/explanation/skill_tags reuse the exact same JSONB
    // shapes — PracticeItemOption/PracticeItemAnswerKey from
    // practice-json-types.ts) so the objective-grading pure functions
    // (gradeItem/computeFeedbackSummary in lib/practice/practice-attempt-grading.ts)
    // work unchanged against a ListeningItem. Kept as its own table rather
    // than reusing practice_items directly because practice_exercises.user_id
    // is NOT NULL (every practice exercise is privately owned by the student
    // who generated it) — curated Listening content has no single owner and
    // must be readable by every student's mock attempt.

    await queryRunner.query(`
      CREATE TABLE "listening_items" (
        "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
        "source_id"   UUID         NOT NULL,
        "position"    INTEGER      NOT NULL,
        "prompt"      TEXT         NOT NULL,
        "options"     JSONB,
        "answer_key"  JSONB        NOT NULL,
        "explanation" TEXT,
        "skill_tags"  TEXT[]       NOT NULL DEFAULT '{}',
        "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_listening_items" PRIMARY KEY ("id"),
        CONSTRAINT "uq_listening_items_source_position" UNIQUE ("source_id", "position"),
        CONSTRAINT "fk_listening_items_source" FOREIGN KEY ("source_id")
          REFERENCES "listening_sources" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_listening_items_position_positive" CHECK ("position" >= 1),
        CONSTRAINT "chk_listening_items_prompt_not_blank" CHECK (length(trim(both from "prompt")) > 0)
      )
    `);

    // ── mock_attempts ────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "mock_attempts" (
        "id"                   UUID                          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"              UUID                          NOT NULL,
        "exam_type"            "exam_type_enum"              NOT NULL,
        "status"               "mock_attempt_status_enum"    NOT NULL DEFAULT 'in_progress',
        "started_at"           TIMESTAMPTZ                   NOT NULL,
        "submitted_at"         TIMESTAMPTZ,
        "result_mock_test_id"  UUID,
        "created_at"           TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ                   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_mock_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_mock_attempts_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_mock_attempts_result_mock_test" FOREIGN KEY ("result_mock_test_id")
          REFERENCES "mock_tests" ("id") ON DELETE SET NULL,
        CONSTRAINT "chk_mock_attempts_submitted_after_started" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at"),
        CONSTRAINT "chk_mock_attempts_completed_has_result" CHECK (
          "status" <> 'completed' OR ("submitted_at" IS NOT NULL AND "result_mock_test_id" IS NOT NULL)
        )
      )
    `);

    // At most one in-progress full mock attempt per user — same shape as
    // uq_practice_attempts_one_active_per_user / uq_writing_submissions_one_active_per_user.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_mock_attempts_one_active_per_user" ON "mock_attempts" ("user_id") WHERE "status" = 'in_progress'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_mock_attempts_user_started" ON "mock_attempts" ("user_id", "started_at" DESC)`,
    );

    // ── mock_attempt_sections ────────────────────────────────────────────────
    // One row per non-Speaking MOCK_EXAM_CATALOG section (13 for B2_FIRST),
    // pre-created as 'pending' when the attempt starts. content_type decides
    // which single content FK is populated once the section is started —
    // practice_exercise_id (Use of English / Reading, AI-generated per
    // student), writing_task_id (Writing, AI-generated per student), or
    // listening_source_id (curated, shared across students).
    //
    // The 3 content FKs use ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    // — same "protect history, defer the check to COMMIT" pattern as
    // practice_attempts -> practice_exercises (AddPracticeDomain). A
    // mock_attempt_section is never the reason a practice_exercises/
    // writing_tasks/listening_sources row can't be hard-deleted through an
    // unrelated cleanup path elsewhere, but the FK still rejects an orphaning
    // delete rather than silently cascading it away.

    await queryRunner.query(`
      CREATE TABLE "mock_attempt_sections" (
        "id"                    UUID                                       NOT NULL DEFAULT gen_random_uuid(),
        "mock_attempt_id"       UUID                                       NOT NULL,
        "section_code"          VARCHAR(100)                               NOT NULL,
        "content_type"          "mock_attempt_section_content_type_enum"   NOT NULL,
        "practice_exercise_id"  UUID,
        "writing_task_id"       UUID,
        "listening_source_id"   UUID,
        "status"                "mock_attempt_section_status_enum"         NOT NULL DEFAULT 'pending',
        "time_limit_seconds"    INTEGER                                    NOT NULL,
        "started_at"            TIMESTAMPTZ,
        "completed_at"          TIMESTAMPTZ,
        "answers"               JSONB                                      NOT NULL DEFAULT '[]',
        "raw_score"             NUMERIC(10,2),
        "max_score"             NUMERIC(10,2),
        "grading_feedback"      JSONB,
        "created_at"            TIMESTAMPTZ                                NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMPTZ                                NOT NULL DEFAULT now(),
        CONSTRAINT "pk_mock_attempt_sections" PRIMARY KEY ("id"),
        CONSTRAINT "uq_mock_attempt_sections_attempt_section" UNIQUE ("mock_attempt_id", "section_code"),
        CONSTRAINT "fk_mock_attempt_sections_attempt" FOREIGN KEY ("mock_attempt_id")
          REFERENCES "mock_attempts" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_mock_attempt_sections_practice_exercise" FOREIGN KEY ("practice_exercise_id")
          REFERENCES "practice_exercises" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "fk_mock_attempt_sections_writing_task" FOREIGN KEY ("writing_task_id")
          REFERENCES "writing_tasks" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "fk_mock_attempt_sections_listening_source" FOREIGN KEY ("listening_source_id")
          REFERENCES "listening_sources" ("id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_mock_attempt_sections_time_limit_positive" CHECK ("time_limit_seconds" > 0),
        CONSTRAINT "chk_mock_attempt_sections_content_fk_matches_type" CHECK (
          ("content_type" = 'practice_exercise' AND "writing_task_id" IS NULL AND "listening_source_id" IS NULL) OR
          ("content_type" = 'writing_task' AND "practice_exercise_id" IS NULL AND "listening_source_id" IS NULL) OR
          ("content_type" = 'listening' AND "practice_exercise_id" IS NULL AND "writing_task_id" IS NULL)
        ),
        CONSTRAINT "chk_mock_attempt_sections_completed_after_started" CHECK ("completed_at" IS NULL OR "started_at" IS NOT NULL),
        CONSTRAINT "chk_mock_attempt_sections_max_score_positive" CHECK ("max_score" IS NULL OR "max_score" > 0),
        CONSTRAINT "chk_mock_attempt_sections_raw_score_nonneg" CHECK ("raw_score" IS NULL OR "raw_score" >= 0),
        CONSTRAINT "chk_mock_attempt_sections_completed_has_result" CHECK (
          "status" <> 'completed' OR (
            "completed_at" IS NOT NULL AND "raw_score" IS NOT NULL AND "max_score" IS NOT NULL
          )
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_mock_attempt_sections_attempt" ON "mock_attempt_sections" ("mock_attempt_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_listening_sources_part_status" ON "listening_sources" ("exam_code", "paper_code", "part_code", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Tablas (orden inverso de dependencias) ──────────────────────────────

    await queryRunner.query(`DROP TABLE "mock_attempt_sections"`);
    await queryRunner.query(`DROP TABLE "mock_attempts"`);
    await queryRunner.query(`DROP TABLE "listening_items"`);
    await queryRunner.query(`DROP TABLE "listening_sources"`);

    // ── Enum types ───────────────────────────────────────────────────────────

    await queryRunner.query(`DROP TYPE "mock_attempt_section_content_type_enum"`);
    await queryRunner.query(`DROP TYPE "mock_attempt_section_status_enum"`);
    await queryRunner.query(`DROP TYPE "mock_attempt_status_enum"`);
    await queryRunner.query(`DROP TYPE "listening_source_status_enum"`);
  }
}
