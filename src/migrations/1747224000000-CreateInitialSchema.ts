import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialSchema1747224000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ────────────────────────────────────────────────────────────

    await queryRunner.query(`CREATE TYPE "user_role_enum" AS ENUM ('student', 'teacher', 'admin')`);
    await queryRunner.query(
      `CREATE TYPE "english_level_enum" AS ENUM ('A1', 'A2', 'B1', 'B1_PLUS', 'B2', 'C1', 'C2')`,
    );
    await queryRunner.query(
      `CREATE TYPE "target_exam_enum" AS ENUM ('B2_FIRST', 'C1_ADVANCED', 'IELTS', 'TOEFL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "goal_status_enum" AS ENUM ('active', 'completed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "score_type_enum" AS ENUM ('correct_answers', 'percentage', 'rubric', 'time_only', 'custom')`,
    );
    await queryRunner.query(
      `CREATE TYPE "week_plan_status_enum" AS ENUM ('draft', 'active', 'completed', 'archived')`,
    );
    await queryRunner.query(
      `CREATE TYPE "day_of_week_enum" AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')`,
    );
    await queryRunner.query(
      `CREATE TYPE "activity_priority_enum" AS ENUM ('low', 'medium', 'high')`,
    );
    await queryRunner.query(
      `CREATE TYPE "planned_activity_status_enum" AS ENUM ('pending', 'in_progress', 'completed', 'skipped')`,
    );
    await queryRunner.query(
      `CREATE TYPE "difficulty_level_enum" AS ENUM ('easy', 'medium', 'hard')`,
    );
    await queryRunner.query(
      `CREATE TYPE "score_criterion_enum" AS ENUM ('content', 'communicative_achievement', 'organization', 'language', 'fluency', 'pronunciation', 'vocabulary', 'grammar', 'interaction', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "storage_provider_enum" AS ENUM ('s3', 'local', 'external')`,
    );
    await queryRunner.query(
      `CREATE TYPE "exam_type_enum" AS ENUM ('B2_FIRST', 'C1_ADVANCED', 'IELTS', 'TOEFL')`,
    );
    await queryRunner.query(`CREATE TYPE "mock_type_enum" AS ENUM ('full', 'partial')`);
    await queryRunner.query(
      `CREATE TYPE "resource_type_enum" AS ENUM ('pdf', 'link', 'video', 'template', 'vocabulary', 'grammar', 'writing_sample', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "recommendation_type_enum" AS ENUM ('weakness', 'study_plan', 'reminder', 'improvement', 'general')`,
    );
    await queryRunner.query(
      `CREATE TYPE "recommendation_priority_enum" AS ENUM ('low', 'medium', 'high')`,
    );
    await queryRunner.query(
      `CREATE TYPE "recommendation_status_enum" AS ENUM ('pending', 'applied', 'dismissed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "recommendation_source_enum" AS ENUM ('rule_based', 'ai', 'manual')`,
    );

    // ── skills ────────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "skills" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "name"        VARCHAR(100) NOT NULL,
        "slug"        VARCHAR(100) NOT NULL,
        "description" TEXT,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_skills" PRIMARY KEY ("id"),
        CONSTRAINT "uq_skills_name" UNIQUE ("name"),
        CONSTRAINT "uq_skills_slug" UNIQUE ("slug")
      )
    `);

    // ── exam_sections ─────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "exam_sections" (
        "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
        "skill_id"                 UUID         NOT NULL,
        "name"                     VARCHAR(255) NOT NULL,
        "slug"                     VARCHAR(100) NOT NULL,
        "description"              TEXT,
        "max_score"                INTEGER,
        "default_duration_minutes" INTEGER,
        "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_exam_sections" PRIMARY KEY ("id"),
        CONSTRAINT "uq_exam_sections_slug" UNIQUE ("slug"),
        CONSTRAINT "fk_exam_sections_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE RESTRICT
      )
    `);

    // ── users ─────────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                  UUID                NOT NULL DEFAULT gen_random_uuid(),
        "email"               VARCHAR(255)        NOT NULL,
        "password_hash"       VARCHAR(255),
        "first_name"          VARCHAR(100),
        "last_name"           VARCHAR(100),
        "role"                "user_role_enum"    NOT NULL DEFAULT 'student',
        "is_active"           BOOLEAN             NOT NULL DEFAULT true,
        "email_verified_at"   TIMESTAMPTZ,
        "created_at"          TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);

    // ── user_profiles ─────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "user_profiles" (
        "id"                    UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "user_id"               UUID                  NOT NULL,
        "current_level"         "english_level_enum",
        "target_exam"           "target_exam_enum",
        "target_score"          INTEGER,
        "target_date"           DATE,
        "study_days_per_week"   INTEGER,
        "daily_study_minutes"   INTEGER,
        "timezone"              VARCHAR(100),
        "created_at"            TIMESTAMPTZ           NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMPTZ           NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_user_profiles_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // ── user_goals ────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "user_goals" (
        "id"           UUID                 NOT NULL DEFAULT gen_random_uuid(),
        "user_id"      UUID                 NOT NULL,
        "title"        VARCHAR(255)         NOT NULL,
        "description"  TEXT,
        "target_exam"  "target_exam_enum",
        "target_score" INTEGER,
        "target_date"  DATE,
        "status"       "goal_status_enum"   NOT NULL DEFAULT 'active',
        "created_at"   TIMESTAMPTZ          NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ          NOT NULL DEFAULT now(),
        "deleted_at"   TIMESTAMPTZ,
        CONSTRAINT "pk_user_goals" PRIMARY KEY ("id"),
        CONSTRAINT "fk_user_goals_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // ── activity_templates ────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "activity_templates" (
        "id"                       UUID               NOT NULL DEFAULT gen_random_uuid(),
        "skill_id"                 UUID               NOT NULL,
        "exam_section_id"          UUID,
        "name"                     VARCHAR(255)       NOT NULL,
        "description"              TEXT,
        "score_type"               "score_type_enum"  NOT NULL,
        "default_duration_minutes" INTEGER,
        "max_score"                INTEGER,
        "is_active"                BOOLEAN            NOT NULL DEFAULT true,
        "created_at"               TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ        NOT NULL DEFAULT now(),
        CONSTRAINT "pk_activity_templates" PRIMARY KEY ("id"),
        CONSTRAINT "fk_activity_templates_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_activity_templates_exam_section" FOREIGN KEY ("exam_section_id")
          REFERENCES "exam_sections" ("id") ON DELETE SET NULL
      )
    `);

    // ── custom_activities ─────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "custom_activities" (
        "id"                       UUID               NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  UUID               NOT NULL,
        "skill_id"                 UUID,
        "exam_section_id"          UUID,
        "name"                     VARCHAR(255)       NOT NULL,
        "description"              TEXT,
        "score_type"               "score_type_enum",
        "default_duration_minutes" INTEGER,
        "max_score"                INTEGER,
        "created_at"               TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ        NOT NULL DEFAULT now(),
        "deleted_at"               TIMESTAMPTZ,
        CONSTRAINT "pk_custom_activities" PRIMARY KEY ("id"),
        CONSTRAINT "fk_custom_activities_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_custom_activities_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_custom_activities_exam_section" FOREIGN KEY ("exam_section_id")
          REFERENCES "exam_sections" ("id") ON DELETE SET NULL
      )
    `);

    // ── weekly_plans ──────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "weekly_plans" (
        "id"               UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID                     NOT NULL,
        "week_start_date"  DATE                     NOT NULL,
        "week_end_date"    DATE                     NOT NULL,
        "title"            VARCHAR(255),
        "status"           "week_plan_status_enum"  NOT NULL DEFAULT 'draft',
        "created_at"       TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "pk_weekly_plans" PRIMARY KEY ("id"),
        CONSTRAINT "uq_weekly_plans_user_week" UNIQUE ("user_id", "week_start_date"),
        CONSTRAINT "fk_weekly_plans_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // ── plan_days ─────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "plan_days" (
        "id"             UUID                NOT NULL DEFAULT gen_random_uuid(),
        "weekly_plan_id" UUID                NOT NULL,
        "day_of_week"    "day_of_week_enum"  NOT NULL,
        "date"           DATE,
        "notes"          TEXT,
        "created_at"     TIMESTAMPTZ         NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMPTZ         NOT NULL DEFAULT now(),
        CONSTRAINT "pk_plan_days" PRIMARY KEY ("id"),
        CONSTRAINT "uq_plan_days_plan_day" UNIQUE ("weekly_plan_id", "day_of_week"),
        CONSTRAINT "fk_plan_days_weekly_plan" FOREIGN KEY ("weekly_plan_id")
          REFERENCES "weekly_plans" ("id") ON DELETE CASCADE
      )
    `);

    // ── planned_activities ────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "planned_activities" (
        "id"                         UUID                            NOT NULL DEFAULT gen_random_uuid(),
        "plan_day_id"                UUID                            NOT NULL,
        "activity_template_id"       UUID,
        "custom_activity_id"         UUID,
        "title"                      VARCHAR(255)                    NOT NULL,
        "description"                TEXT,
        "skill_id"                   UUID,
        "exam_section_id"            UUID,
        "scheduled_order"            INTEGER                         NOT NULL DEFAULT 0,
        "estimated_duration_minutes" INTEGER,
        "priority"                   "activity_priority_enum"        NOT NULL DEFAULT 'medium',
        "status"                     "planned_activity_status_enum"  NOT NULL DEFAULT 'pending',
        "scheduled_at"               TIMESTAMPTZ,
        "completed_at"               TIMESTAMPTZ,
        "created_at"                 TIMESTAMPTZ                     NOT NULL DEFAULT now(),
        "updated_at"                 TIMESTAMPTZ                     NOT NULL DEFAULT now(),
        "deleted_at"                 TIMESTAMPTZ,
        CONSTRAINT "pk_planned_activities" PRIMARY KEY ("id"),
        CONSTRAINT "fk_planned_activities_plan_day" FOREIGN KEY ("plan_day_id")
          REFERENCES "plan_days" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_planned_activities_template" FOREIGN KEY ("activity_template_id")
          REFERENCES "activity_templates" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_planned_activities_custom" FOREIGN KEY ("custom_activity_id")
          REFERENCES "custom_activities" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_planned_activities_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_planned_activities_exam_section" FOREIGN KEY ("exam_section_id")
          REFERENCES "exam_sections" ("id") ON DELETE SET NULL
      )
    `);

    // ── study_sessions ────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "study_sessions" (
        "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"             UUID         NOT NULL,
        "planned_activity_id" UUID,
        "started_at"          TIMESTAMPTZ,
        "ended_at"            TIMESTAMPTZ,
        "duration_minutes"    INTEGER,
        "notes"               TEXT,
        "created_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_study_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_study_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_study_sessions_planned_activity" FOREIGN KEY ("planned_activity_id")
          REFERENCES "planned_activities" ("id") ON DELETE SET NULL
      )
    `);

    // ── activity_scores ───────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "activity_scores" (
        "id"                  UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "user_id"             UUID                    NOT NULL,
        "planned_activity_id" UUID,
        "skill_id"            UUID,
        "exam_section_id"     UUID,
        "score_type"          "score_type_enum"       NOT NULL,
        "raw_score"           NUMERIC(10, 2),
        "max_score"           NUMERIC(10, 2),
        "percentage"          NUMERIC(5, 2),
        "correct_answers"     INTEGER,
        "total_questions"     INTEGER,
        "time_spent_minutes"  INTEGER,
        "difficulty"          "difficulty_level_enum",
        "notes"               TEXT,
        "attempted_at"        TIMESTAMPTZ             NOT NULL,
        "created_at"          TIMESTAMPTZ             NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ             NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        CONSTRAINT "pk_activity_scores" PRIMARY KEY ("id"),
        CONSTRAINT "fk_activity_scores_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_activity_scores_planned_activity" FOREIGN KEY ("planned_activity_id")
          REFERENCES "planned_activities" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_activity_scores_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_activity_scores_exam_section" FOREIGN KEY ("exam_section_id")
          REFERENCES "exam_sections" ("id") ON DELETE SET NULL
      )
    `);

    // ── activity_score_details ────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "activity_score_details" (
        "id"                UUID                   NOT NULL DEFAULT gen_random_uuid(),
        "activity_score_id" UUID                   NOT NULL,
        "criterion"         "score_criterion_enum" NOT NULL,
        "score"             NUMERIC(10, 2)         NOT NULL,
        "max_score"         NUMERIC(10, 2),
        "notes"             TEXT,
        "created_at"        TIMESTAMPTZ            NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ            NOT NULL DEFAULT now(),
        CONSTRAINT "pk_activity_score_details" PRIMARY KEY ("id"),
        CONSTRAINT "fk_activity_score_details_score" FOREIGN KEY ("activity_score_id")
          REFERENCES "activity_scores" ("id") ON DELETE CASCADE
      )
    `);

    // ── mock_tests ────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "mock_tests" (
        "id"                       UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  UUID                  NOT NULL,
        "name"                     VARCHAR(255)          NOT NULL,
        "exam_type"                "exam_type_enum"      NOT NULL,
        "mock_type"                "mock_type_enum"      NOT NULL,
        "taken_at"                 TIMESTAMPTZ,
        "estimated_cambridge_score" INTEGER,
        "estimated_level"          "english_level_enum",
        "notes"                    TEXT,
        "created_at"               TIMESTAMPTZ           NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ           NOT NULL DEFAULT now(),
        "deleted_at"               TIMESTAMPTZ,
        CONSTRAINT "pk_mock_tests" PRIMARY KEY ("id"),
        CONSTRAINT "fk_mock_tests_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // ── evidence_files ────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "evidence_files" (
        "id"                  UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"             UUID                     NOT NULL,
        "planned_activity_id" UUID,
        "activity_score_id"   UUID,
        "mock_test_id"        UUID,
        "file_name"           VARCHAR(255)             NOT NULL,
        "original_file_name"  VARCHAR(255),
        "mime_type"           VARCHAR(100),
        "file_size"           INTEGER,
        "storage_provider"    "storage_provider_enum"  NOT NULL DEFAULT 's3',
        "storage_key"         VARCHAR(1024)            NOT NULL,
        "public_url"          TEXT,
        "uploaded_at"         TIMESTAMPTZ              NOT NULL,
        "created_at"          TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        CONSTRAINT "pk_evidence_files" PRIMARY KEY ("id"),
        CONSTRAINT "fk_evidence_files_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_evidence_files_planned_activity" FOREIGN KEY ("planned_activity_id")
          REFERENCES "planned_activities" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_evidence_files_activity_score" FOREIGN KEY ("activity_score_id")
          REFERENCES "activity_scores" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_evidence_files_mock_test" FOREIGN KEY ("mock_test_id")
          REFERENCES "mock_tests" ("id") ON DELETE SET NULL
      )
    `);

    // ── mock_section_scores ───────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "mock_section_scores" (
        "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
        "mock_test_id"   UUID           NOT NULL,
        "skill_id"       UUID,
        "section_name"   VARCHAR(255)   NOT NULL,
        "raw_score"      NUMERIC(10, 2),
        "max_score"      NUMERIC(10, 2),
        "percentage"     NUMERIC(5, 2),
        "cambridge_score" INTEGER,
        "notes"          TEXT,
        "created_at"     TIMESTAMPTZ    NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMPTZ    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_mock_section_scores" PRIMARY KEY ("id"),
        CONSTRAINT "fk_mock_section_scores_mock_test" FOREIGN KEY ("mock_test_id")
          REFERENCES "mock_tests" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_mock_section_scores_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE SET NULL
      )
    `);

    // ── resources ─────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "resources" (
        "id"            UUID                  NOT NULL DEFAULT gen_random_uuid(),
        "user_id"       UUID,
        "title"         VARCHAR(255)          NOT NULL,
        "description"   TEXT,
        "resource_type" "resource_type_enum"  NOT NULL,
        "url"           TEXT,
        "storage_key"   VARCHAR(1024),
        "is_global"     BOOLEAN               NOT NULL DEFAULT false,
        "created_at"    TIMESTAMPTZ           NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ           NOT NULL DEFAULT now(),
        "deleted_at"    TIMESTAMPTZ,
        CONSTRAINT "pk_resources" PRIMARY KEY ("id"),
        CONSTRAINT "fk_resources_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    // ── resource_skills (pivot) ───────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "resource_skills" (
        "resource_id" UUID        NOT NULL,
        "skill_id"    UUID        NOT NULL,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_resource_skills" PRIMARY KEY ("resource_id", "skill_id"),
        CONSTRAINT "fk_resource_skills_resource" FOREIGN KEY ("resource_id")
          REFERENCES "resources" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_resource_skills_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE CASCADE
      )
    `);

    // ── recommendations ───────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "recommendations" (
        "id"                  UUID                            NOT NULL DEFAULT gen_random_uuid(),
        "user_id"             UUID                            NOT NULL,
        "skill_id"            UUID,
        "exam_section_id"     UUID,
        "title"               VARCHAR(255)                    NOT NULL,
        "description"         TEXT,
        "recommendation_type" "recommendation_type_enum"     NOT NULL,
        "priority"            "recommendation_priority_enum"  NOT NULL DEFAULT 'medium',
        "status"              "recommendation_status_enum"    NOT NULL DEFAULT 'pending',
        "source"              "recommendation_source_enum"    NOT NULL DEFAULT 'rule_based',
        "created_at"          TIMESTAMPTZ                     NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ                     NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMPTZ,
        CONSTRAINT "pk_recommendations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_recommendations_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_recommendations_skill" FOREIGN KEY ("skill_id")
          REFERENCES "skills" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_recommendations_exam_section" FOREIGN KEY ("exam_section_id")
          REFERENCES "exam_sections" ("id") ON DELETE SET NULL
      )
    `);

    // ── notification_preferences ──────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "id"                      UUID         NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                 UUID         NOT NULL,
        "study_reminders_enabled" BOOLEAN      NOT NULL DEFAULT false,
        "weekly_summary_enabled"  BOOLEAN      NOT NULL DEFAULT false,
        "reminder_time"           VARCHAR(10),
        "timezone"                VARCHAR(100),
        "created_at"              TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "uq_notification_preferences_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_notification_preferences_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // ── Indexes ───────────────────────────────────────────────────────────────

    await queryRunner.query(`CREATE INDEX "idx_users_email" ON "users" ("email")`);
    await queryRunner.query(
      `CREATE INDEX "idx_users_deleted_at" ON "users" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE INDEX "idx_user_goals_user_id" ON "user_goals" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_exam_sections_skill_id" ON "exam_sections" ("skill_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_templates_skill_id" ON "activity_templates" ("skill_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_custom_activities_user_id" ON "custom_activities" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_weekly_plans_user_id" ON "weekly_plans" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_plan_days_weekly_plan_id" ON "plan_days" ("weekly_plan_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_planned_activities_plan_day_id" ON "planned_activities" ("plan_day_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_planned_activities_status" ON "planned_activities" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_study_sessions_user_id" ON "study_sessions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_scores_user_id" ON "activity_scores" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_activity_scores_attempted_at" ON "activity_scores" ("attempted_at")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_mock_tests_user_id" ON "mock_tests" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_evidence_files_user_id" ON "evidence_files" ("user_id")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_resources_user_id" ON "resources" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_recommendations_user_id" ON "recommendations" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_recommendations_status" ON "recommendations" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse dependency order

    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "recommendations" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "resource_skills" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "resources" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mock_section_scores" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "evidence_files" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mock_tests" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_score_details" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_scores" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "study_sessions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "planned_activities" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_days" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weekly_plans" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_activities" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_templates" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_goals" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_profiles" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "exam_sections" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "skills" CASCADE`);

    // Drop enum types

    await queryRunner.query(`DROP TYPE IF EXISTS "recommendation_source_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recommendation_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recommendation_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "recommendation_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "resource_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "mock_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "exam_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "storage_provider_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "score_criterion_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "difficulty_level_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "planned_activity_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "activity_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "day_of_week_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "week_plan_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "score_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "goal_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "target_exam_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "english_level_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
