import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vocabulary for classifying mistakes outside Word Formation: the structures
 * Key Word Transformation tests, the word classes Open Cloze tests, and the
 * two categories the Writing grader can produce that Practice never does.
 *
 * Additive only — no table, no column, no data change. Existing rows keep
 * whatever they were classified as.
 *
 * `ALTER TYPE ... ADD VALUE` inside a transaction is allowed from Postgres 12
 * on, provided the new value is not USED in that same transaction. This
 * migration only declares the values (nothing writes them until the
 * classifiers run later), so it is safe under TypeORM's transactional
 * migration runner. `IF NOT EXISTS` additionally makes a partial re-run
 * harmless.
 */
export class AddTaskTypeClassificationEnums1788000000000 implements MigrationInterface {
  name = 'AddTaskTypeClassificationEnums1788000000000';

  private static readonly ERROR_TYPES = ['punctuation', 'register'];

  private static readonly ERROR_SUBTYPES = [
    // Key Word Transformation (UoE Part 4) — the structure under test.
    'passive',
    'conditional',
    'reported_speech',
    'comparative',
    'causative',
    'wish_regret',
    'used_to',
    'modal_deduction',
    'relative_clause',
    'gerund_infinitive',
    'fixed_expression',
    'key_word_altered',
    'word_count',
    // Open Cloze (UoE Part 2) — the class of word the gap required.
    'preposition',
    'article',
    'auxiliary',
    'pronoun',
    'linker',
    'quantifier',
  ];

  private static readonly SOURCES = ['writing_submission'];

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of AddTaskTypeClassificationEnums1788000000000.ERROR_TYPES) {
      await queryRunner.query(
        `ALTER TYPE "mistake_error_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
    for (const value of AddTaskTypeClassificationEnums1788000000000.ERROR_SUBTYPES) {
      await queryRunner.query(
        `ALTER TYPE "mistake_error_subtype_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
    for (const value of AddTaskTypeClassificationEnums1788000000000.SOURCES) {
      await queryRunner.query(
        `ALTER TYPE "mistake_source_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  /**
   * Postgres cannot remove a value from an enum. Reverting would mean
   * recreating all three types and rewriting every column that uses them —
   * destructive for any row already classified with a new value, and far
   * riskier than the additive change it would undo. Deliberately a no-op:
   * an unused enum value costs nothing.
   */
  async down(): Promise<void> {
    // Intentionally empty — see the comment above.
  }
}
