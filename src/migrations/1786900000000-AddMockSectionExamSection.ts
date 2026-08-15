import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMockSectionExamSection1786900000000 implements MigrationInterface {
  name = 'AddMockSectionExamSection1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "mock_section_scores" ADD COLUMN "exam_section_id" UUID`);
    await queryRunner.query(
      `ALTER TABLE "mock_section_scores" ADD CONSTRAINT "fk_mock_section_scores_exam_section" FOREIGN KEY ("exam_section_id")
        REFERENCES "exam_sections" ("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_mock_section_scores_exam_section_id" ON "mock_section_scores" ("exam_section_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_mock_section_scores_exam_section_id"`);
    await queryRunner.query(
      `ALTER TABLE "mock_section_scores" DROP CONSTRAINT "fk_mock_section_scores_exam_section"`,
    );
    await queryRunner.query(`ALTER TABLE "mock_section_scores" DROP COLUMN "exam_section_id"`);
  }
}
