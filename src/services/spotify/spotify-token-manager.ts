import { decrypt, encrypt } from '@lib/shared/crypto';
import type { SpotifyConnection } from '@models/SpotifyConnection';

interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

interface PersistedTokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  expiresAt: Date;
}

interface SpotifyTokenManagerDeps {
  refreshAccessToken: (refreshToken: string) => Promise<RefreshedTokens>;
  persistTokens: (userId: string, data: PersistedTokens) => Promise<void>;
}

const EXPIRY_BUFFER_MS = 60_000;

class SpotifyTokenManager {
  constructor(private readonly deps: SpotifyTokenManagerDeps) {}

  async getValidAccessToken(connection: SpotifyConnection): Promise<string> {
    const msUntilExpiry = connection.token_expires_at.getTime() - Date.now();
    if (msUntilExpiry > EXPIRY_BUFFER_MS) {
      return decrypt(connection.access_token_encrypted);
    }

    const currentRefreshToken = decrypt(connection.refresh_token_encrypted);
    const refreshed = await this.deps.refreshAccessToken(currentRefreshToken);
    const nextRefreshToken = refreshed.refreshToken ?? currentRefreshToken;
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

    await this.deps.persistTokens(connection.user_id, {
      accessTokenEncrypted: encrypt(refreshed.accessToken),
      refreshTokenEncrypted: encrypt(nextRefreshToken),
      expiresAt,
    });

    connection.access_token_encrypted = encrypt(refreshed.accessToken);
    connection.refresh_token_encrypted = encrypt(nextRefreshToken);
    connection.token_expires_at = expiresAt;

    return refreshed.accessToken;
  }
}

export { SpotifyTokenManager };
export type { SpotifyTokenManagerDeps, RefreshedTokens, PersistedTokens };
