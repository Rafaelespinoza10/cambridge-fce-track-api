import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListeningAiLinkedPlannedActivity1788200000000 implements MigrationInterface {
  name = 'AddListeningAiLinkedPlannedActivity1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── planned_activities: fourth AI-link column ───────────────────────────
    //
    // A completed standalone Listening attempt never registered a
    // planned_activity, so it never showed up on the Plan/Home "This Week"
    // count the way Practice/Writing/Daily Session already do — see
    // SubmitListeningAttemptService. Extends the three-way XOR into a
    // four-way XOR: source = 'ai_generated' now means exactly one of
    // practice_attempt_id / writing_submission_id / daily_session_submission_id
    // / listening_attempt_id is set. ON DELETE SET NULL, same as the other
    // three — losing the attempt must not cascade into deleting the plan
    // entry. Partial unique index so a submit retry (idempotent replay) can
    // never create a second planned_activity for the same attempt.

    await queryRunner.query(`
      ALTER TABLE "planned_activities" ADD COLUMN "listening_attempt_id" UUID
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD CONSTRAINT "fk_planned_activities_listening_attempt" FOREIGN KEY ("listening_attempt_id")
          REFERENCES "listening_attempts" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP CONSTRAINT "chk_planned_activities_ai_link"
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities"
        ADD CONSTRAINT "chk_planned_activities_ai_link" CHECK (
          (
            "source" = 'manual' AND "practice_attempt_id" IS NULL AND "writing_submission_id" IS NULL
              AND "daily_session_submission_id" IS NULL AND "listening_attempt_id" IS NULL
          )
          OR (
            "source" = 'ai_generated' AND (
              ("practice_attempt_id" IS NOT NULL AND "writing_submission_id" IS NULL AND "daily_session_submission_id" IS NULL AND "listening_attempt_id" IS NULL)
              OR ("practice_attempt_id" IS NULL AND "writing_submission_id" IS NOT NULL AND "daily_session_submission_id" IS NULL AND "listening_attempt_id" IS NULL)
              OR ("practice_attempt_id" IS NULL AND "writing_submission_id" IS NULL AND "daily_session_submission_id" IS NOT NULL AND "listening_attempt_id" IS NULL)
              OR ("practice_attempt_id" IS NULL AND "writing_submission_id" IS NULL AND "daily_session_submission_id" IS NULL AND "listening_attempt_id" IS NOT NULL)
            )
          )
        )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_planned_activities_listening_attempt" ON "planned_activities" ("listening_attempt_id") WHERE "listening_attempt_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_planned_activities_listening_attempt"`);

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

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP CONSTRAINT "fk_planned_activities_listening_attempt"
    `);

    await queryRunner.query(`
      ALTER TABLE "planned_activities" DROP COLUMN "listening_attempt_id"
    `);
  }
}
