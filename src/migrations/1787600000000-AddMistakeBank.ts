import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mistake Bank — concept + occurrences. Touches no existing table: the
 * Practice flow keeps writing exactly what it wrote before, and these two
 * tables are only ever written by RecordPracticeMistakesService.
 *
 * `english_level_enum` already exists (created by the initial schema and
 * reused by practice_exercises/flashcards), so it is reused as-is here.
 */
export class AddMistakeBank1787600000000 implements MigrationInterface {
  name = 'AddMistakeBank1787600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE \"mistake_source_enum\" AS ENUM ('practice_attempt', 'mock_attempt', 'daily_session')",
    );
    await queryRunner.query(
      "CREATE TYPE \"mistake_error_type_enum\" AS ENUM ('word_class', 'spelling', 'vocabulary', 'prefix_suffix', 'collocation', 'phrasal_verb', 'grammar', 'misunderstanding', 'careless', 'unknown')",
    );
    await queryRunner.query(
      "CREATE TYPE \"mistake_error_subtype_enum\" AS ENUM ('noun_to_adjective', 'noun_to_adverb', 'adjective_to_noun', 'adjective_to_adverb', 'verb_to_noun', 'verb_to_adjective', 'prefix_error', 'suffix_error', 'spelling_change')",
    );
    await queryRunner.query(
      "CREATE TYPE \"word_class_enum\" AS ENUM ('noun', 'verb', 'adjective', 'adverb', 'other')",
    );

    await queryRunner.query(
      'CREATE TABLE "mistake_concepts" (' +
        '"id" uuid NOT NULL DEFAULT gen_random_uuid(), ' +
        '"user_id" uuid NOT NULL, ' +
        '"concept_key" varchar(255) NOT NULL, ' +
        '"source" "mistake_source_enum" NOT NULL, ' +
        '"skill_slug" varchar(50) NOT NULL, ' +
        '"exam_code" varchar(50) NOT NULL, ' +
        '"paper_code" varchar(50) NOT NULL, ' +
        '"part_code" varchar(50) NOT NULL, ' +
        '"task_type" varchar(50), ' +
        '"base_word" varchar(120), ' +
        '"prompt" text NOT NULL, ' +
        '"correct_answer" text NOT NULL, ' +
        '"last_user_answer" text NOT NULL, ' +
        '"explanation" text, ' +
        '"target_level" "english_level_enum", ' +
        '"error_type" "mistake_error_type_enum" NOT NULL DEFAULT \'unknown\', ' +
        '"error_subtype" "mistake_error_subtype_enum", ' +
        '"expected_word_class" "word_class_enum", ' +
        '"user_word_class" "word_class_enum", ' +
        '"times_wrong" integer NOT NULL DEFAULT 0, ' +
        '"times_correct" integer NOT NULL DEFAULT 0, ' +
        '"first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, ' +
        '"last_wrong_at" TIMESTAMP WITH TIME ZONE NOT NULL, ' +
        '"last_correct_at" TIMESTAMP WITH TIME ZONE, ' +
        '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ' +
        '"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ' +
        'CONSTRAINT "PK_mistake_concepts_id" PRIMARY KEY ("id"), ' +
        'CONSTRAINT "FK_mistake_concepts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION)',
    );
    // The concept's identity: one row per user per concept. Every upsert
    // (RecordPracticeMistakesService) conflicts on exactly this.
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_mistake_concepts_user_key" ON "mistake_concepts" ("user_id", "concept_key")',
    );
    // Default listing order (most recently failed first).
    await queryRunner.query(
      'CREATE INDEX "idx_mistake_concepts_user_last_wrong" ON "mistake_concepts" ("user_id", "last_wrong_at" DESC)',
    );
    // The skill/part filters the Mistakes screen exposes.
    await queryRunner.query(
      'CREATE INDEX "idx_mistake_concepts_user_skill_part" ON "mistake_concepts" ("user_id", "skill_slug", "part_code")',
    );

    await queryRunner.query(
      'CREATE TABLE "mistake_occurrences" (' +
        '"id" uuid NOT NULL DEFAULT gen_random_uuid(), ' +
        '"user_id" uuid NOT NULL, ' +
        '"concept_id" uuid NOT NULL, ' +
        '"source" "mistake_source_enum" NOT NULL, ' +
        '"practice_attempt_id" uuid, ' +
        '"practice_exercise_id" uuid, ' +
        '"practice_item_id" uuid, ' +
        '"practice_answer_id" uuid, ' +
        '"user_answer" text NOT NULL, ' +
        '"normalized_answer" text, ' +
        '"correct_answer" text NOT NULL, ' +
        '"is_unanswered" boolean NOT NULL DEFAULT false, ' +
        '"occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, ' +
        '"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ' +
        'CONSTRAINT "PK_mistake_occurrences_id" PRIMARY KEY ("id"), ' +
        'CONSTRAINT "FK_mistake_occurrences_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION, ' +
        'CONSTRAINT "FK_mistake_occurrences_concept" FOREIGN KEY ("concept_id") REFERENCES "mistake_concepts"("id") ON DELETE CASCADE)',
    );
    // Idempotency guard: a replayed submission can never insert a second
    // occurrence for the same graded answer, so times_wrong can never be
    // double-counted. Partial index — future non-practice sources leave
    // practice_answer_id NULL and are unaffected.
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_mistake_occurrences_practice_answer" ON "mistake_occurrences" ("practice_answer_id") WHERE "practice_answer_id" IS NOT NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_mistake_occurrences_concept" ON "mistake_occurrences" ("concept_id", "occurred_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_mistake_occurrences_user" ON "mistake_occurrences" ("user_id", "occurred_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_mistake_occurrences_user"');
    await queryRunner.query('DROP INDEX "idx_mistake_occurrences_concept"');
    await queryRunner.query('DROP INDEX "uq_mistake_occurrences_practice_answer"');
    await queryRunner.query('DROP TABLE "mistake_occurrences"');
    await queryRunner.query('DROP INDEX "idx_mistake_concepts_user_skill_part"');
    await queryRunner.query('DROP INDEX "idx_mistake_concepts_user_last_wrong"');
    await queryRunner.query('DROP INDEX "uq_mistake_concepts_user_key"');
    await queryRunner.query('DROP TABLE "mistake_concepts"');
    await queryRunner.query('DROP TYPE "word_class_enum"');
    await queryRunner.query('DROP TYPE "mistake_error_subtype_enum"');
    await queryRunner.query('DROP TYPE "mistake_error_type_enum"');
    await queryRunner.query('DROP TYPE "mistake_source_enum"');
  }
}
