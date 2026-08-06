import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPracticeExerciseIdempotency1785988603186 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── practice_exercises (existing table from AddPracticeDomain — additive,
    // safe change only) ─────────────────────────────────────────────────────
    //
    // idempotency_key is always explicitly supplied by the caller for every
    // new row (see GeneratePracticeExerciseService) — the DEFAULT here only
    // backfills safely if this table already has rows in some environment
    // when this migration runs, same reasoning as study_sessions' new
    // columns in AddFlashcardsModule. It is never relied upon for new rows.

    await queryRunner.query(
      `ALTER TABLE "practice_exercises" ADD COLUMN "idempotency_key" UUID NOT NULL DEFAULT gen_random_uuid()`,
    );

    // Partial: scoped to WHERE deleted_at IS NULL so a soft-deleted exercise
    // never blocks reusing its idempotency_key for a brand new generation —
    // same soft-delete-aware pattern as flashcards' dedupe index
    // (uq_flashcards_dedupe in AddFlashcardsModule), adapted here to a plain
    // UNIQUE INDEX instead of a table CONSTRAINT because flashcard_reviews
    // (the other idempotency_key precedent) has no soft delete, so its own
    // UNIQUE constraint didn't need to be partial.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_practice_exercises_user_idempotency" ON "practice_exercises" ("user_id", "idempotency_key") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_practice_exercises_user_idempotency"`);
    await queryRunner.query(`ALTER TABLE "practice_exercises" DROP COLUMN "idempotency_key"`);
  }
}
