import type { DataSource, EntityManager, Repository } from 'typeorm';
import { SpotifyConnection } from '@models/SpotifyConnection';

interface UpsertSpotifyConnectionData {
  userId: string;
  spotifyUserId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
  scope: string | null;
}

interface UpdateSpotifyConnectionTokensData {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
}

class SpotifyConnectionRepository {
  private readonly repo: Repository<SpotifyConnection>;

  constructor(source: DataSource | EntityManager) {
    this.repo = source.getRepository(SpotifyConnection);
  }

  async findByUserId(userId: string): Promise<SpotifyConnection | null> {
    return this.repo.findOne({ where: { user_id: userId } });
  }

  async upsert(data: UpsertSpotifyConnectionData): Promise<void> {
    await this.repo.upsert(
      {
        user_id: data.userId,
        spotify_user_id: data.spotifyUserId,
        access_token_encrypted: data.accessTokenEncrypted,
        refresh_token_encrypted: data.refreshTokenEncrypted,
        token_expires_at: data.tokenExpiresAt,
        scope: data.scope,
      },
      ['user_id'],
    );
  }

  async updateTokens(userId: string, data: UpdateSpotifyConnectionTokensData): Promise<void> {
    await this.repo.update(
      { user_id: userId },
      {
        access_token_encrypted: data.accessTokenEncrypted,
        refresh_token_encrypted: data.refreshTokenEncrypted,
        token_expires_at: data.tokenExpiresAt,
      },
    );
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.repo.delete({ user_id: userId });
  }
}

export { SpotifyConnectionRepository };
export type { UpsertSpotifyConnectionData, UpdateSpotifyConnectionTokensData };
