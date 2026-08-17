import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWritingPart2TaskTypes1787000000000 implements MigrationInterface {
  name = 'AddWritingPart2TaskTypes1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres allows ALTER TYPE ... ADD VALUE inside a transaction as long
    // as the new value isn't also used within that same transaction — this
    // migration only adds the values, never inserts rows using them.
    await queryRunner.query(`ALTER TYPE "writing_task_type_enum" ADD VALUE 'article'`);
    await queryRunner.query(`ALTER TYPE "writing_task_type_enum" ADD VALUE 'email'`);
    await queryRunner.query(`ALTER TYPE "writing_task_type_enum" ADD VALUE 'report'`);
    await queryRunner.query(`ALTER TYPE "writing_task_type_enum" ADD VALUE 'review'`);
  }

  public async down(): Promise<void> {
    // Postgres has no ALTER TYPE ... DROP VALUE — reverting would require
    // recreating the enum type (drop + recreate with only 'essay', which
    // fails if any row already uses a Part 2 value) and is deliberately not
    // supported here, same as this codebase's other enum-only migrations
    // would need to be handled case-by-case if ever reverted.
    throw new Error(
      'AddWritingPart2TaskTypes cannot be reverted: Postgres has no ALTER TYPE ... DROP VALUE',
    );
  }
}
