import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeMockExamSections1786000000000 implements MigrationInterface {
  name = 'NormalizeMockExamSections1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mock_tests" RENAME COLUMN "estimated_cambridge_score" TO "estimated_standardized_score"`);
    await queryRunner.query(`ALTER TABLE "mock_tests" ALTER COLUMN "estimated_standardized_score" TYPE NUMERIC(10, 2) USING "estimated_standardized_score"::NUMERIC`);
    await queryRunner.query(`ALTER TABLE "mock_tests" ADD COLUMN "score_scale" VARCHAR(32)`);
    await queryRunner.query(`UPDATE "mock_tests" SET "score_scale" = CASE "exam_type" WHEN 'IELTS' THEN 'IELTS_BAND' WHEN 'TOEFL' THEN 'TOEFL_IBT_1_TO_6' ELSE 'CAMBRIDGE_ENGLISH_SCALE' END`);
    await queryRunner.query(`ALTER TABLE "mock_tests" ALTER COLUMN "score_scale" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "mock_section_scores" RENAME COLUMN "cambridge_score" TO "standardized_score"`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ALTER COLUMN "standardized_score" TYPE NUMERIC(10, 2) USING "standardized_score"::NUMERIC`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ADD COLUMN "section_code" VARCHAR(100)`);
    await queryRunner.query(`UPDATE "mock_section_scores" SET "section_code" = UPPER(REGEXP_REPLACE("section_name", '[^A-Za-z0-9]+', '_', 'g'))`);
    await queryRunner.query(`UPDATE "mock_section_scores" SET "section_code" = 'READING_AND_USE_OF_ENGLISH' WHERE "section_code" IN ('READING_USE_OF_ENGLISH', 'READING_AND_USE_OF_ENGLISH')`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ALTER COLUMN "section_code" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ADD CONSTRAINT "uq_mock_section_scores_mock_section_code" UNIQUE ("mock_test_id", "section_code")`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" DROP COLUMN "section_name"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ADD COLUMN "section_name" VARCHAR(255)`);
    await queryRunner.query(`UPDATE "mock_section_scores" SET "section_name" = "section_code"`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ALTER COLUMN "section_name" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" DROP CONSTRAINT "uq_mock_section_scores_mock_section_code"`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" DROP COLUMN "section_code"`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" RENAME COLUMN "standardized_score" TO "cambridge_score"`);
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ALTER COLUMN "cambridge_score" TYPE INTEGER USING ROUND("cambridge_score")::INTEGER`);
    await queryRunner.query(`ALTER TABLE "mock_tests" DROP COLUMN "score_scale"`);
    await queryRunner.query(`ALTER TABLE "mock_tests" RENAME COLUMN "estimated_standardized_score" TO "estimated_cambridge_score"`);
    await queryRunner.query(`ALTER TABLE "mock_tests" ALTER COLUMN "estimated_cambridge_score" TYPE INTEGER USING ROUND("estimated_cambridge_score")::INTEGER`);
  }
}
