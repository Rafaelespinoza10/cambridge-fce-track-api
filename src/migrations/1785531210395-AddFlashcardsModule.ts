import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFlashcardsModule1785531210395 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enum types ────────────────────────────────────────────────────────────

    await queryRunner.query(
      `CREATE TYPE "flashcard_type_enum" AS ENUM ('phrasal_verb', 'collocation', 'vocabulary', 'expression', 'grammar', 'custom')`,
    );
    await queryRunner.query(
      `CREATE TYPE "flashcard_status_enum" AS ENUM ('new', 'learning', 'review', 'suspended')`,
    );
    await queryRunner.query(
      `CREATE TYPE "review_rating_enum" AS ENUM ('again', 'hard', 'good', 'easy')`,
    );
    await queryRunner.query(
      `CREATE TYPE "study_session_type_enum" AS ENUM ('activity', 'flashcard_review')`,
    );
    await queryRunner.query(
      `CREATE TYPE "study_session_status_enum" AS ENUM ('active', 'completed')`,
    );

    // ── study_sessions (existing table — additive, safe changes only) ─────────
    //
    // La tabla no tiene ningún lector/escritor en el código (confirmado antes de
    // esta migración) y ningún seed la usa, pero se trata como si pudiera tener
    // filas en algún entorno real: las columnas nuevas llevan DEFAULT (backfill
    // seguro), y los CHECK nuevos se agregan NOT VALID para no escanear/bloquear
    // filas existentes. Quedan pendientes de VALIDATE CONSTRAINT en una migración
    // futura, una vez confirmado en todos los entornos que ninguna fila los viola.

    await queryRunner.query(
      `ALTER TABLE "study_sessions" ADD COLUMN "session_type" "study_session_type_enum" NOT NULL DEFAULT 'activity'`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_sessions" ADD COLUMN "status" "study_session_status_enum" NOT NULL DEFAULT 'active'`,
    );

    // Ancla estructural para la FK compuesta de flashcard_reviews (§ integridad de propiedad).
    await queryRunner.query(
      `ALTER TABLE "study_sessions" ADD CONSTRAINT "uq_study_sessions_id_user" UNIQUE ("id", "user_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "study_sessions" ADD CONSTRAINT "chk_study_sessions_ended_after_started" CHECK ("ended_at" IS NULL OR "started_at" IS NULL OR "ended_at" >= "started_at") NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_sessions" ADD CONSTRAINT "chk_study_sessions_completed_has_ended_at" CHECK ("status" <> 'completed' OR "ended_at" IS NOT NULL) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_sessions" ADD CONSTRAINT "chk_study_sessions_flashcard_review_has_started_at" CHECK ("session_type" <> 'flashcard_review' OR "started_at" IS NOT NULL) NOT VALID`,
    );

    // ── decks ───────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "decks" (
        "id"          UUID          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID          NOT NULL,
        "name"        VARCHAR(255)  NOT NULL,
        "description" TEXT,
        "color"       VARCHAR(7),
        "is_archived" BOOLEAN       NOT NULL DEFAULT false,
        "created_at"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "deleted_at"  TIMESTAMPTZ,
        CONSTRAINT "pk_decks" PRIMARY KEY ("id"),
        CONSTRAINT "uq_decks_id_user" UNIQUE ("id", "user_id"),
        CONSTRAINT "fk_decks_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_decks_color_hex" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$')
      )
    `);

    // ── flashcards ────────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "flashcards" (
        "id"               UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"          UUID                     NOT NULL,
        "deck_id"          UUID                     NOT NULL,
        "type"             "flashcard_type_enum"    NOT NULL,
        "front"            VARCHAR(500)             NOT NULL,
        "back"             VARCHAR(500)             NOT NULL,
        "translation"      VARCHAR(500),
        "example"          TEXT,
        "personal_example" TEXT,
        "notes"            TEXT,
        "source_name"      VARCHAR(255),
        "source_url"       TEXT,
        "level"            "english_level_enum",
        "tags"             TEXT[]                   NOT NULL DEFAULT '{}',
        "status"           "flashcard_status_enum"  NOT NULL DEFAULT 'new',
        "next_review_at"   TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "interval_minutes" INTEGER                  NOT NULL DEFAULT 0,
        "ease_factor"      NUMERIC(4,2)             NOT NULL DEFAULT 2.50,
        "repetitions"      INTEGER                  NOT NULL DEFAULT 0,
        "lapses"           INTEGER                  NOT NULL DEFAULT 0,
        "created_at"       TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ              NOT NULL DEFAULT now(),
        "deleted_at"       TIMESTAMPTZ,
        CONSTRAINT "pk_flashcards" PRIMARY KEY ("id"),
        CONSTRAINT "uq_flashcards_id_user" UNIQUE ("id", "user_id"),
        CONSTRAINT "fk_flashcards_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_flashcards_deck_user" FOREIGN KEY ("deck_id", "user_id")
          REFERENCES "decks" ("id", "user_id") ON DELETE CASCADE,
        CONSTRAINT "chk_flashcards_interval_nonneg" CHECK ("interval_minutes" >= 0),
        CONSTRAINT "chk_flashcards_ease_range" CHECK ("ease_factor" BETWEEN 1.3 AND 3.0),
        CONSTRAINT "chk_flashcards_repetitions_nonneg" CHECK ("repetitions" >= 0),
        CONSTRAINT "chk_flashcards_lapses_nonneg" CHECK ("lapses" >= 0)
      )
    `);

    // ── flashcard_reviews (log inmutable) ──────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "flashcard_reviews" (
        "id"                        UUID                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                   UUID                     NOT NULL,
        "flashcard_id"              UUID                     NOT NULL,
        "study_session_id"          UUID                     NOT NULL,
        "idempotency_key"           UUID                     NOT NULL,
        "rating"                    "review_rating_enum"     NOT NULL,
        "previous_status"           "flashcard_status_enum"  NOT NULL,
        "new_status"                "flashcard_status_enum"  NOT NULL,
        "previous_next_review_at"   TIMESTAMPTZ              NOT NULL,
        "new_next_review_at"        TIMESTAMPTZ              NOT NULL,
        "previous_interval_minutes" INTEGER                  NOT NULL,
        "new_interval_minutes"      INTEGER                  NOT NULL,
        "previous_ease_factor"      NUMERIC(4,2)             NOT NULL,
        "new_ease_factor"           NUMERIC(4,2)             NOT NULL,
        "previous_repetitions"      INTEGER                  NOT NULL,
        "new_repetitions"           INTEGER                  NOT NULL,
        "previous_lapses"           INTEGER                  NOT NULL,
        "new_lapses"                INTEGER                  NOT NULL,
        "response_time_ms"          INTEGER,
        "reviewed_at"               TIMESTAMPTZ              NOT NULL DEFAULT now(),
        CONSTRAINT "pk_flashcard_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "uq_flashcard_reviews_idempotency" UNIQUE ("user_id", "idempotency_key"),
        CONSTRAINT "fk_flashcard_reviews_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_flashcard_reviews_flashcard_user" FOREIGN KEY ("flashcard_id", "user_id")
          REFERENCES "flashcards" ("id", "user_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "fk_flashcard_reviews_session_user" FOREIGN KEY ("study_session_id", "user_id")
          REFERENCES "study_sessions" ("id", "user_id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT "chk_flashcard_reviews_interval_nonneg" CHECK ("previous_interval_minutes" >= 0 AND "new_interval_minutes" >= 0),
        CONSTRAINT "chk_flashcard_reviews_ease_range" CHECK ("previous_ease_factor" BETWEEN 1.3 AND 3.0 AND "new_ease_factor" BETWEEN 1.3 AND 3.0),
        CONSTRAINT "chk_flashcard_reviews_repetitions_nonneg" CHECK ("previous_repetitions" >= 0 AND "new_repetitions" >= 0),
        CONSTRAINT "chk_flashcard_reviews_lapses_nonneg" CHECK ("previous_lapses" >= 0 AND "new_lapses" >= 0),
        CONSTRAINT "chk_flashcard_reviews_response_time_nonneg" CHECK ("response_time_ms" IS NULL OR "response_time_ms" >= 0)
      )
    `);

    // ── daily_review_stats ──────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "daily_review_stats" (
        "id"                          UUID          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                     UUID          NOT NULL,
        "local_date"                  DATE          NOT NULL,
        "timezone"                    VARCHAR(100)  NOT NULL,
        "daily_goal"                  INTEGER       NOT NULL,
        "cards_due_at_first_session"  INTEGER       NOT NULL,
        "required_reviews"            INTEGER       NOT NULL,
        "cards_reviewed"              INTEGER       NOT NULL DEFAULT 0,
        "unique_cards_reviewed"       INTEGER       NOT NULL DEFAULT 0,
        "minutes_studied"             INTEGER       NOT NULL DEFAULT 0,
        "goal_completed"              BOOLEAN       NOT NULL DEFAULT false,
        "created_at"                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_daily_review_stats" PRIMARY KEY ("id"),
        CONSTRAINT "uq_daily_review_stats_user_date" UNIQUE ("user_id", "local_date"),
        CONSTRAINT "fk_daily_review_stats_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_daily_review_stats_daily_goal_positive" CHECK ("daily_goal" > 0),
        CONSTRAINT "chk_daily_review_stats_due_nonneg" CHECK ("cards_due_at_first_session" >= 0),
        CONSTRAINT "chk_daily_review_stats_required_nonneg" CHECK ("required_reviews" >= 0),
        CONSTRAINT "chk_daily_review_stats_required_formula" CHECK ("required_reviews" = LEAST("daily_goal", "cards_due_at_first_session")),
        CONSTRAINT "chk_daily_review_stats_reviewed_nonneg" CHECK ("cards_reviewed" >= 0),
        CONSTRAINT "chk_daily_review_stats_unique_reviewed_nonneg" CHECK ("unique_cards_reviewed" >= 0),
        CONSTRAINT "chk_daily_review_stats_unique_le_total" CHECK ("unique_cards_reviewed" <= "cards_reviewed"),
        CONSTRAINT "chk_daily_review_stats_minutes_nonneg" CHECK ("minutes_studied" >= 0),
        CONSTRAINT "chk_daily_review_stats_goal_completion_rule" CHECK ("goal_completed" = false OR "unique_cards_reviewed" >= GREATEST("required_reviews", 1))
      )
    `);

    // ── flashcard_preferences ───────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE TABLE "flashcard_preferences" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID        NOT NULL,
        "daily_goal"  INTEGER     NOT NULL DEFAULT 10,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_flashcard_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "uq_flashcard_preferences_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_flashcard_preferences_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_flashcard_preferences_daily_goal_positive" CHECK ("daily_goal" > 0)
      )
    `);

    // ── Indexes ────────────────────────────────────────────────────────────────
    // Cada índice corresponde a una consulta real descrita en el diseño; no se
    // agrega ninguno "por si acaso" (p. ej. no hay índice simple por
    // study_session_id: el compuesto (study_session_id, flashcard_id) ya lo cubre
    // por la regla de prefijo izquierdo).

    // "Mis mazos disponibles" (no borrados, no archivados).
    await queryRunner.query(
      `CREATE INDEX "idx_decks_user_available" ON "decks" ("user_id") WHERE "deleted_at" IS NULL AND "is_archived" = false`,
    );

    // "Tarjetas activas de este mazo" (detalle del mazo).
    await queryRunner.query(
      `CREATE INDEX "idx_flashcards_deck_active" ON "flashcards" ("deck_id") WHERE "deleted_at" IS NULL`,
    );

    // "Tarjetas pendientes del usuario ahora" — consulta más caliente del módulo.
    await queryRunner.query(
      `CREATE INDEX "idx_flashcards_due" ON "flashcards" ("user_id", "next_review_at") WHERE "deleted_at" IS NULL AND "status" <> 'suspended'`,
    );

    // Duplicados reales (mismo frente+reverso+tipo en el mismo mazo); requiere
    // expresiones (LOWER) y condición parcial, por lo que debe ser un índice,
    // no una constraint UNIQUE de tabla.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_flashcards_dedupe" ON "flashcards" ("deck_id", "type", (LOWER("front")), (LOWER("back"))) WHERE "deleted_at" IS NULL`,
    );

    // "¿Ya se repasó esta tarjeta dentro de esta sesión?" y, por prefijo
    // izquierdo, también sirve "reviews de esta sesión".
    await queryRunner.query(
      `CREATE INDEX "idx_flashcard_reviews_session_flashcard" ON "flashcard_reviews" ("study_session_id", "flashcard_id")`,
    );

    // "Historial completo de esta tarjeta" (todas las sesiones, no solo una).
    await queryRunner.query(
      `CREATE INDEX "idx_flashcard_reviews_flashcard_id" ON "flashcard_reviews" ("flashcard_id")`,
    );

    // "Historial del usuario por rango de fechas" / "tarjetas con más errores".
    await queryRunner.query(
      `CREATE INDEX "idx_flashcard_reviews_user_reviewed_at" ON "flashcard_reviews" ("user_id", "reviewed_at")`,
    );

    // A lo sumo una sesión activa de flashcards por usuario (no afecta 'activity').
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_study_sessions_one_active_flashcard_review" ON "study_sessions" ("user_id") WHERE "status" = 'active' AND "session_type" = 'flashcard_review'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Tablas nuevas (orden inverso de dependencias) ──────────────────────────

    await queryRunner.query(`DROP TABLE "flashcard_reviews"`);
    await queryRunner.query(`DROP TABLE "daily_review_stats"`);
    await queryRunner.query(`DROP TABLE "flashcard_preferences"`);
    await queryRunner.query(`DROP TABLE "flashcards"`);
    await queryRunner.query(`DROP TABLE "decks"`);

    // ── Revertir study_sessions ─────────────────────────────────────────────────

    await queryRunner.query(`DROP INDEX "uq_study_sessions_one_active_flashcard_review"`);
    await queryRunner.query(
      `ALTER TABLE "study_sessions" DROP CONSTRAINT "chk_study_sessions_flashcard_review_has_started_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_sessions" DROP CONSTRAINT "chk_study_sessions_completed_has_ended_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_sessions" DROP CONSTRAINT "chk_study_sessions_ended_after_started"`,
    );
    await queryRunner.query(
      `ALTER TABLE "study_sessions" DROP CONSTRAINT "uq_study_sessions_id_user"`,
    );
    await queryRunner.query(`ALTER TABLE "study_sessions" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "study_sessions" DROP COLUMN "session_type"`);

    // ── Enum types (orden inverso) ──────────────────────────────────────────────

    await queryRunner.query(`DROP TYPE "study_session_status_enum"`);
    await queryRunner.query(`DROP TYPE "study_session_type_enum"`);
    await queryRunner.query(`DROP TYPE "review_rating_enum"`);
    await queryRunner.query(`DROP TYPE "flashcard_status_enum"`);
    await queryRunner.query(`DROP TYPE "flashcard_type_enum"`);
  }
}
