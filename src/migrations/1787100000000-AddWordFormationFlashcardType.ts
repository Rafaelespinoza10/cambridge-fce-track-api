import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWordFormationFlashcardType1787100000000 implements MigrationInterface {
  name = 'AddWordFormationFlashcardType1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "flashcard_type_enum" ADD VALUE 'word_formation'`);
  }

  public async down(): Promise<void> {
    // Postgres has no ALTER TYPE ... DROP VALUE — reverting would require
    // recreating the enum type, which fails if any row already uses
    // 'word_formation'. Deliberately not supported, same as this codebase's
    // other enum-add-only migrations (e.g. AddWritingPart2TaskTypes).
    throw new Error(
      'AddWordFormationFlashcardType cannot be reverted: Postgres has no ALTER TYPE ... DROP VALUE',
    );
  }
}
