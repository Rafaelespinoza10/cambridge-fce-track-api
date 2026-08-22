import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { encrypt, decrypt } from '@lib/shared/crypto';
import { SpotifyTokenManager } from './spotify-token-manager';
import type { SpotifyTokenManagerDeps } from './spotify-token-manager';
import type { SpotifyConnection } from '@models/SpotifyConnection';

const TEST_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
const ORIGINAL_KEY = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
const USER_ID = 'user-1';

beforeEach(() => {
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
});

function makeConnection(overrides: Partial<SpotifyConnection> = {}): SpotifyConnection {
  return {
    id: 'conn-1',
    user_id: USER_ID,
    spotify_user_id: 'spotify-user-1',
    access_token_encrypted: encrypt('current-access-token'),
    refresh_token_encrypted: encrypt('current-refresh-token'),
    token_expires_at: new Date(Date.now() + 3600 * 1000),
    scope: 'playlist-read-private',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as SpotifyConnection;
}

describe('SpotifyTokenManager.getValidAccessToken', () => {
  it('returns the decrypted access token without refreshing when far from expiry', async () => {
    const connection = makeConnection();
    let refreshCalled = false;
    const deps: SpotifyTokenManagerDeps = {
      refreshAccessToken: async () => {
        refreshCalled = true;
        return { accessToken: 'new-token', expiresIn: 3600 };
      },
      persistTokens: async () => {},
    };
    const manager = new SpotifyTokenManager(deps);

    const token = await manager.getValidAccessToken(connection);

    assert.equal(token, 'current-access-token');
    assert.equal(refreshCalled, false);
  });

  it('refreshes and persists rotated tokens when the access token is expired', async () => {
    const connection = makeConnection({ token_expires_at: new Date(Date.now() - 1000) });
    let persisted: { userId: string; accessTokenEncrypted: string; refreshTokenEncrypted: string } | null =
      null;
    const deps: SpotifyTokenManagerDeps = {
      refreshAccessToken: async (refreshToken) => {
        assert.equal(refreshToken, 'current-refresh-token');
        return { accessToken: 'refreshed-access-token', refreshToken: 'rotated-refresh-token', expiresIn: 3600 };
      },
      persistTokens: async (userId, data) => {
        persisted = {
          userId,
          accessTokenEncrypted: data.accessTokenEncrypted,
          refreshTokenEncrypted: data.refreshTokenEncrypted,
        };
      },
    };
    const manager = new SpotifyTokenManager(deps);

    const token = await manager.getValidAccessToken(connection);

    assert.equal(token, 'refreshed-access-token');
    assert.ok(persisted);
    assert.equal(persisted!.userId, USER_ID);
    assert.equal(decrypt(persisted!.accessTokenEncrypted), 'refreshed-access-token');
    assert.equal(decrypt(persisted!.refreshTokenEncrypted), 'rotated-refresh-token');
  });

  it('keeps the existing refresh token when Spotify does not rotate it', async () => {
    const connection = makeConnection({ token_expires_at: new Date(Date.now() - 1000) });
    let persistedRefreshTokenEncrypted = '';
    const deps: SpotifyTokenManagerDeps = {
      refreshAccessToken: async () => ({ accessToken: 'refreshed-access-token', expiresIn: 3600 }),
      persistTokens: async (_userId, data) => {
        persistedRefreshTokenEncrypted = data.refreshTokenEncrypted;
      },
    };
    const manager = new SpotifyTokenManager(deps);

    await manager.getValidAccessToken(connection);

    assert.equal(decrypt(persistedRefreshTokenEncrypted), 'current-refresh-token');
  });
});
