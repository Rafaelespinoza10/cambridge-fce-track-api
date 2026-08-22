import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpotifyConnections1787500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── resource_type_enum: new values for imported Spotify content ─────────
    // Not referenced by any statement later in this same migration, so no
    // transaction-visibility issue with ALTER TYPE ... ADD VALUE.

    await queryRunner.query(`ALTER TYPE "resource_type_enum" ADD VALUE 'podcast'`);
    await queryRunner.query(`ALTER TYPE "resource_type_enum" ADD VALUE 'playlist'`);

    // ── resources.image_url ───────────────────────────────────────────────
    // Cover art for imported Spotify playlists/shows. Nullable and generic
    // enough to be reused by any future resource type that has an image.

    await queryRunner.query(`ALTER TABLE "resources" ADD COLUMN "image_url" VARCHAR(2000)`);

    // ── spotify_connections ──────────────────────────────────────────────
    // One row per user (at most), storing the OAuth tokens needed to browse
    // that user's Spotify library server-side. Tokens are encrypted at rest
    // (see src/lib/shared/crypto.ts) — never stored in plaintext. Hard
    // delete on disconnect: this is a binary connected/not-connected state,
    // not history worth keeping.

    await queryRunner.query(`
      CREATE TABLE "spotify_connections" (
        "id"                       UUID          NOT NULL DEFAULT gen_random_uuid(),
        "user_id"                  UUID          NOT NULL,
        "spotify_user_id"          VARCHAR(255)  NOT NULL,
        "access_token_encrypted"   TEXT          NOT NULL,
        "refresh_token_encrypted"  TEXT          NOT NULL,
        "token_expires_at"         TIMESTAMPTZ   NOT NULL,
        "scope"                    VARCHAR(500),
        "created_at"               TIMESTAMPTZ   NOT NULL DEFAULT now(),
        "updated_at"               TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_spotify_connections" PRIMARY KEY ("id"),
        CONSTRAINT "uq_spotify_connections_user" UNIQUE ("user_id"),
        CONSTRAINT "fk_spotify_connections_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_spotify_connections_spotify_user_id_not_blank" CHECK (length(trim(both from "spotify_user_id")) > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "spotify_connections"`);
    await queryRunner.query(`ALTER TABLE "resources" DROP COLUMN "image_url"`);

    // Postgres cannot drop values from an existing enum type (no
    // ALTER TYPE ... DROP VALUE) — reverting 'podcast'/'playlist' would
    // require rebuilding resource_type_enum from scratch, which risks
    // breaking any row already using them. Left as a no-op, same convention
    // as other enum-only additions in this codebase.
  }
}
