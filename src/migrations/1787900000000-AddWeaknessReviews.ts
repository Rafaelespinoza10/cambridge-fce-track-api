import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spaced retesting: one table, no changes to anything that already exists.
 *
 * `mistake_error_type_enum` and `mistake_error_subtype_enum` already exist
 * (AddMistakeBank) and are reused as-is, so a review's pattern identity can
 * never drift from a mistake's.
 */
export class AddWeaknessReviews1787900000000 implements MigrationInterface {
  name = 'AddWeaknessReviews1787900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE \"weakness_review_status_enum\" AS ENUM ('scheduled', 'completed', 'cancelled')",
    );
    await queryRunner.query(
      "CREATE TYPE \"weakness_review_result_enum\" AS ENUM ('pass', 'partial', 'fail')",
    );

    await queryRunner.query(
      'CREATE TABLE "weakness_reviews" (' +
        '"id" uuid NOT NULL DEFAULT gen_random_uuid(), ' +
        '"user_id" uuid NOT NULL, ' +
        '"skill_slug" varchar(50) NOT NULL, ' +
        '"exam_code" varchar(50) NOT NULL, ' +
        '"paper_code" varchar(50) NOT NULL, ' +
        '"part_code" varchar(50) NOT NULL, ' +
        '"error_type" "mistake_error_type_enum" NOT NULL, ' +
        '"error_subtype" "mistake_error_subtype_enum", ' +
        '"status" "weakness_review_status_enum" NOT NULL DEFAULT \'scheduled\', ' +
        '"due_at" TIMESTAMP WITH TIME ZONE NOT NULL, ' +
        '"interval_days" integer NOT NULL, ' +
        '"consecutive_successful_reviews" integer NOT NULL DEFAULT 0, ' +
        '"mastery_score_before" integer NOT NULL, ' +
        '"completed_at" TIMESTAMP WITH TIME ZONE, ' +
        '"result" "weakness_review_result_enum", ' +
        '"correct_count" integer, ' +
        '"total_count" integer, ' +
        '"distinct_correct_families" integer, ' +
        '"mastery_score_after" integer, ' +
        '"practice_exercise_id" uuid, ' +
        '"practice_attempt_id" uuid, ' +
        '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ' +
        '"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ' +
        'CONSTRAINT "PK_weakness_reviews_id" PRIMARY KEY ("id"), ' +
        'CONSTRAINT "FK_weakness_reviews_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION, ' +
        // A completed review must carry its outcome, and a scheduled one must
        // not pretend to have one — the two states are structurally distinct.
        'CONSTRAINT "chk_weakness_reviews_completed_has_result" CHECK (' +
        '("status" <> \'completed\') OR ' +
        '("completed_at" IS NOT NULL AND "result" IS NOT NULL AND "correct_count" IS NOT NULL ' +
        'AND "total_count" IS NOT NULL AND "mastery_score_after" IS NOT NULL)), ' +
        'CONSTRAINT "chk_weakness_reviews_interval_positive" CHECK ("interval_days" >= 1))',
    );

    // At most ONE scheduled review per user per pattern. Split into two
    // partial indexes rather than COALESCE("error_subtype"::text, 'none') in
    // a single expression index: Postgres's enum->text cast is only STABLE
    // (an enum value's label could in principle be renamed with ALTER TYPE
    // ... RENAME VALUE), and an index expression must be IMMUTABLE — casting
    // it fails with "functions in index expression must be marked IMMUTABLE".
    // Comparing the bare enum column (no cast) has no such restriction, so
    // two indexes — one for rows with a subtype, one for rows without —
    // enforce the exact same "NULL is its own bucket" invariant with no cast
    // and no function-trust workaround.
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_weakness_reviews_active_with_subtype" ON "weakness_reviews" ' +
        '("user_id", "part_code", "error_type", "error_subtype") ' +
        'WHERE "status" = \'scheduled\' AND "error_subtype" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_weakness_reviews_active_no_subtype" ON "weakness_reviews" ' +
        '("user_id", "part_code", "error_type") ' +
        'WHERE "status" = \'scheduled\' AND "error_subtype" IS NULL',
    );
    // The due listing: this user's scheduled reviews, soonest first.
    await queryRunner.query(
      'CREATE INDEX "idx_weakness_reviews_user_due" ON "weakness_reviews" ' +
        '("user_id", "due_at") WHERE "status" = \'scheduled\'',
    );
    // History reads (per pattern, most recent first).
    await queryRunner.query(
      'CREATE INDEX "idx_weakness_reviews_user_pattern" ON "weakness_reviews" ' +
        '("user_id", "part_code", "error_type", "created_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_weakness_reviews_user_pattern"');
    await queryRunner.query('DROP INDEX "idx_weakness_reviews_user_due"');
    await queryRunner.query('DROP INDEX "uq_weakness_reviews_active_no_subtype"');
    await queryRunner.query('DROP INDEX "uq_weakness_reviews_active_with_subtype"');
    await queryRunner.query('DROP TABLE "weakness_reviews"');
    await queryRunner.query('DROP TYPE "weakness_review_result_enum"');
    await queryRunner.query('DROP TYPE "weakness_review_status_enum"');
  }
}
