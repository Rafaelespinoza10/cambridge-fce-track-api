import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiLinkedPlannedActivities1787200000000 implements MigrationInterface {
  name = 'AddAiLinkedPlannedActivities1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum type ────────────────────────────────────────────────────────────

    await queryRunner.query(
      `CREATE TYPE "planned_activity_source_enum" AS ENUM ('manual', 'ai_generated')`,
    );

    // ── planned_activities: source + links back to the AI session that
    // completed it ──────────────────────────────────────────────────────────
    //
    // A row is only ever linked to ONE of practice_attempt_id/writing_submission_id
    // (never both), and only when source = 'ai_generated'. Both FKs are
    // ON DELETE SET NULL — losing the attempt/submission (account purge,
    // admin cleanup) must not cascade into deleting the plan entry itself.
    // Each link column also gets a partial unique index so a submit retry
    // (idempotent replay) can never create a second planned_activity for the
    // same attempt/submission.

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD COLUMN "source" "planned_activity_source_enum" NOT NULL DEFAULT 'manual',
        ADD COLUMN "practice_attempt_id" UUID,
        ADD COLUMN "writing_submission_id" UUID
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD CONSTRAINT "fk_planned_activities_practice_attempt" FOREIGN KEY ("practice_attempt_id")
          REFERENCES "practice_attempts" ("id") ON DELETE SET NULL,
        ADD CONSTRAINT "fk_planned_activities_writing_submission" FOREIGN KEY ("writing_submission_id")
          REFERENCES "writing_submissions" ("id") ON DELETE SET NULL,
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

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_planned_activities_practice_attempt" ON "planned_activities" ("practice_attempt_id") WHERE "practice_attempt_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_planned_activities_writing_submission" ON "planned_activities" ("writing_submission_id") WHERE "writing_submission_id" IS NOT NULL`,
    );

    // ── practice_attempts / writing_submissions: the plan day the eventual
    // activity should attach to, captured at start time and only acted on
    // once the attempt/submission completes ────────────────────────────────

    await queryRunner.query(`
      ALTER TABLE "practice_attempts" ADD COLUMN "plan_day_id" UUID
    `);
    await queryRunner.query(`
      ALTER TABLE "practice_attempts"
        ADD CONSTRAINT "fk_practice_attempts_plan_day" FOREIGN KEY ("plan_day_id")
          REFERENCES "plan_days" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "writing_submissions" ADD COLUMN "plan_day_id" UUID
    `);
    await queryRunner.query(`
      ALTER TABLE "writing_submissions"
        ADD CONSTRAINT "fk_writing_submissions_plan_day" FOREIGN KEY ("plan_day_id")
          REFERENCES "plan_days" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "writing_submissions" DROP CONSTRAINT "fk_writing_submissions_plan_day"`,
    );
    await queryRunner.query(`ALTER TABLE "writing_submissions" DROP COLUMN "plan_day_id"`);

    await queryRunner.query(
      `ALTER TABLE "practice_attempts" DROP CONSTRAINT "fk_practice_attempts_plan_day"`,
    );
    await queryRunner.query(`ALTER TABLE "practice_attempts" DROP COLUMN "plan_day_id"`);

    await queryRunner.query(`DROP INDEX "uq_planned_activities_writing_submission"`);
    await queryRunner.query(`DROP INDEX "uq_planned_activities_practice_attempt"`);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        DROP CONSTRAINT "chk_planned_activities_ai_link",
        DROP CONSTRAINT "fk_planned_activities_writing_submission",
        DROP CONSTRAINT "fk_planned_activities_practice_attempt"
    `);
    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        DROP COLUMN "writing_submission_id",
        DROP COLUMN "practice_attempt_id",
        DROP COLUMN "source"
    `);

    await queryRunner.query(`DROP TYPE "planned_activity_source_enum"`);
  }
}
