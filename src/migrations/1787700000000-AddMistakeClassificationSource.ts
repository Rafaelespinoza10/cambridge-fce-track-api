import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `classification_source` to `mistake_concepts` — additive only, no
 * backfill. Existing rows default to `unknown` (same meaning as their
 * existing `error_type = 'unknown'`: never classified yet). This column is
 * what lets the classifier and the future reclassification script tell "a
 * user manually corrected this" apart from "still needs classifying" —
 * anything with `classification_source = 'user'` must never be
 * automatically overwritten again.
 */
export class AddMistakeClassificationSource1787700000000 implements MigrationInterface {
  name = 'AddMistakeClassificationSource1787700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE \"mistake_classification_source_enum\" AS ENUM ('deterministic', 'ai', 'user', 'unknown')",
    );
    await queryRunner.query(
      'ALTER TABLE "mistake_concepts" ADD COLUMN "classification_source" ' +
        '"mistake_classification_source_enum" NOT NULL DEFAULT \'unknown\'',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "mistake_concepts" DROP COLUMN "classification_source"');
    await queryRunner.query('DROP TYPE "mistake_classification_source_enum"');
  }
}
