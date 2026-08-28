import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The only schema change the Mastery / Weakness rollup needs — no table, no
 * column, no enum.
 *
 * `practice_answers` had no index at all on `user_id`: its FK does not
 * create one (Postgres never does), and every read so far reached it through
 * `attempt_id`. The weakness aggregation
 * (MistakeMasteryRepository.findRemediationDays) starts from "all of THIS
 * user's answers" and joins items/exercises by primary key, so without this
 * it would sequentially scan every answer of every user on each load of the
 * Weaknesses screen. `created_at` is included because the same query buckets
 * by it.
 */
export class AddPracticeAnswersUserIndex1787800000000 implements MigrationInterface {
  name = 'AddPracticeAnswersUserIndex1787800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "idx_practice_answers_user_created" ON "practice_answers" ("user_id", "created_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_practice_answers_user_created"');
  }
}
