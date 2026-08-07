import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddPracticeRecommendations1786000000001 implements MigrationInterface {
  name = 'AddPracticeRecommendations1786000000001';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE \"practice_recommendation_status_enum\" AS ENUM ('pending', 'ready', 'failed')",
    );
    await queryRunner.query(
      'CREATE TABLE "practice_recommendations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "snapshot_hash" char(64) NOT NULL, "locale" varchar(2) NOT NULL, "prompt_version" varchar(100) NOT NULL, "status" "practice_recommendation_status_enum" NOT NULL, "insights_snapshot" jsonb NOT NULL, "recommendation" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_practice_recommendations_id" PRIMARY KEY ("id"), CONSTRAINT "FK_practice_recommendations_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION)',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_practice_recommendations_snapshot" ON "practice_recommendations" ("user_id", "snapshot_hash", "locale", "prompt_version")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_practice_recommendations_user" ON "practice_recommendations" ("user_id", "created_at" DESC)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_practice_recommendations_user"');
    await queryRunner.query('DROP INDEX "uq_practice_recommendations_snapshot"');
    await queryRunner.query('DROP TABLE "practice_recommendations"');
    await queryRunner.query('DROP TYPE "practice_recommendation_status_enum"');
  }
}
