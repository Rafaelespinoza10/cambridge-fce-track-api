import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';
import * as jwt from 'jsonwebtoken';

import { SpotifyService, SpotifyError, SpotifyErrorCode } from './spotify.service';
import type { SpotifyServiceDeps, SpotifyClientPort, ResourcesServicePort } from './spotify.service';
import type {
  UpsertSpotifyConnectionData,
  UpdateSpotifyConnectionTokensData,
} from '@repositories/spotify/spotify-connection.repository';
import type { SpotifyConnection } from '@models/SpotifyConnection';
import type { SpotifyPlaylistItem, SpotifyShowItem } from '@lib/spotify/spotify-api-client';
import { encrypt } from '@lib/shared/crypto';
import { ResourceType } from '@models/enums';

const USER_ID = 'user-1';
const JWT_SECRET = 'test-secret';
const ENCRYPTION_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_ENCRYPTION_KEY = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

afterEach(() => {
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
  if (ORIGINAL_ENCRYPTION_KEY === undefined) {
    delete process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY;
  }
});

function makeConnection(overrides: Partial<SpotifyConnection> = {}): SpotifyConnection {
  return {
    id: 'conn-1',
    user_id: USER_ID,
    spotify_user_id: 'spotify-user-1',
    access_token_encrypted: encrypt('access-token-value'),
    refresh_token_encrypted: encrypt('refresh-token-value'),
    token_expires_at: new Date(Date.now() + 3600 * 1000),
    scope: 'playlist-read-private',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as SpotifyConnection;
}

function makePlaylist(overrides: Partial<SpotifyPlaylistItem> = {}): SpotifyPlaylistItem {
  return {
    id: 'playlist-1',
    name: 'English Learning Mix',
    description: 'B2 vocabulary songs',
    images: [{ url: 'https://img.example.com/playlist.jpg', height: 300, width: 300 }],
    external_urls: { spotify: 'https://open.spotify.com/playlist/playlist-1' },
    owner: { display_name: 'Rafael' },
    tracks: { total: 42 },
    ...overrides,
  };
}

function makeShow(overrides: Partial<SpotifyShowItem> = {}): SpotifyShowItem {
  return {
    id: 'show-1',
    name: 'English Learning Podcast',
    publisher: 'BBC',
    description: 'Learn English every day',
    images: [{ url: 'https://img.example.com/show.jpg', height: 300, width: 300 }],
    external_urls: { spotify: 'https://open.spotify.com/show/show-1' },
    ...overrides,
  };
}

interface World {
  connection: SpotifyConnection | null;
  upserted: UpsertSpotifyConnectionData[];
  updatedTokens: Array<{ userId: string; data: UpdateSpotifyConnectionTokensData }>;
  disconnectedUserIds: string[];
  createdResources: Array<{ userId: string; input: Record<string, unknown> }>;
}

function createWorld(overrides: Partial<World> = {}): World {
  return {
    connection: null,
    upserted: [],
    updatedTokens: [],
    disconnectedUserIds: [],
    createdResources: [],
    ...overrides,
  };
}

function buildDeps(world: World, clientOverrides: Partial<SpotifyClientPort> = {}): SpotifyServiceDeps {
  const spotifyClient: SpotifyClientPort = {
    getAuthorizeUrl: (state) => `https://accounts.spotify.com/authorize?state=${state}`,
    exchangeCodeForTokens: async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      scope: 'playlist-read-private',
    }),
    refreshAccessToken: async () => ({ accessToken: 'refreshed', expiresIn: 3600, scope: '' }),
    getCurrentUserProfile: async () => ({ id: 'spotify-user-1' }),
    getMyPlaylists: async () => [makePlaylist()],
    getMyShows: async () => [makeShow()],
    getPlaylistById: async (_accessToken, id) => makePlaylist({ id }),
    getShowById: async (_accessToken, id) => makeShow({ id }),
    ...clientOverrides,
  };

  const resources: ResourcesServicePort = {
    createResource: async (userId, input) => {
      world.createdResources.push({ userId, input });
      return {
        id: 'resource-1',
        title: input.title,
        description: input.description ?? null,
        url: input.url,
        resourceType: input.resourceType ?? ResourceType.LINK,
        imageUrl: input.imageUrl ?? null,
        isGlobal: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
    },
  };

  return {
    connections: () => ({
      findByUserId: async (userId) =>
        world.connection !== null && world.connection.user_id === userId ? world.connection : null,
      upsert: async (data) => {
        world.upserted.push(data);
        world.connection = makeConnection({ user_id: data.userId, spotify_user_id: data.spotifyUserId });
      },
      updateTokens: async (userId, data) => {
        world.updatedTokens.push({ userId, data });
      },
      deleteByUserId: async (userId) => {
        world.disconnectedUserIds.push(userId);
        world.connection = null;
      },
    }),
    spotifyClient,
    resources: () => resources,
  };
}

function setup(worldOverrides: Partial<World> = {}, clientOverrides: Partial<SpotifyClientPort> = {}) {
  const world = createWorld(worldOverrides);
  const deps = buildDeps(world, clientOverrides);
  const service = new SpotifyService({} as DataSource, deps);
  return { world, service };
}

describe('SpotifyService.getAuthorizeUrl', () => {
  it('returns an authorize URL carrying a signed state token', () => {
    const { service } = setup();
    const url = service.getAuthorizeUrl(USER_ID);
    assert.match(url, /^https:\/\/accounts\.spotify\.com\/authorize\?state=/);
    const state = new URL(url).searchParams.get('state')!;
    const payload = jwt.verify(state, JWT_SECRET) as { userId: string; purpose: string };
    assert.equal(payload.userId, USER_ID);
    assert.equal(payload.purpose, 'spotify_connect');
  });
});

describe('SpotifyService.handleCallback', () => {
  it('exchanges the code and upserts the connection for a valid state', async () => {
    const { world, service } = setup();
    const state = jwt.sign({ userId: USER_ID, purpose: 'spotify_connect' }, JWT_SECRET, {
      expiresIn: '10m',
    });

    await service.handleCallback('auth-code', state);

    assert.equal(world.upserted.length, 1);
    assert.equal(world.upserted[0].userId, USER_ID);
    assert.equal(world.upserted[0].spotifyUserId, 'spotify-user-1');
  });

  it('rejects a state signed with the wrong purpose', async () => {
    const { service } = setup();
    const state = jwt.sign({ userId: USER_ID, purpose: 'something_else' }, JWT_SECRET, {
      expiresIn: '10m',
    });

    await assert.rejects(
      () => service.handleCallback('auth-code', state),
      (error: unknown) => error instanceof SpotifyError && error.code === SpotifyErrorCode.INVALID_STATE,
    );
  });

  it('rejects an expired state', async () => {
    const { service } = setup();
    const state = jwt.sign({ userId: USER_ID, purpose: 'spotify_connect' }, JWT_SECRET, {
      expiresIn: -10,
    });

    await assert.rejects(
      () => service.handleCallback('auth-code', state),
      (error: unknown) => error instanceof SpotifyError && error.code === SpotifyErrorCode.INVALID_STATE,
    );
  });

  it('rejects a state signed with a different secret', async () => {
    const { service } = setup();
    const state = jwt.sign({ userId: USER_ID, purpose: 'spotify_connect' }, 'wrong-secret', {
      expiresIn: '10m',
    });

    await assert.rejects(
      () => service.handleCallback('auth-code', state),
      (error: unknown) => error instanceof SpotifyError && error.code === SpotifyErrorCode.INVALID_STATE,
    );
  });
});

describe('SpotifyService.getConnectionStatus', () => {
  it('reports disconnected when there is no stored connection', async () => {
    const { service } = setup();
    const status = await service.getConnectionStatus(USER_ID);
    assert.deepEqual(status, { connected: false });
  });

  it('reports connected details when a connection exists', async () => {
    const { service } = setup({ connection: makeConnection() });
    const status = await service.getConnectionStatus(USER_ID);
    assert.equal(status.connected, true);
    assert.equal(status.spotifyUserId, 'spotify-user-1');
  });
});

describe('SpotifyService.disconnect', () => {
  it('deletes the stored connection', async () => {
    const { world, service } = setup({ connection: makeConnection() });
    await service.disconnect(USER_ID);
    assert.deepEqual(world.disconnectedUserIds, [USER_ID]);
  });
});

describe('SpotifyService.listPlaylists / listShows', () => {
  it('maps playlists to DTOs', async () => {
    const { service } = setup({ connection: makeConnection() });
    const playlists = await service.listPlaylists(USER_ID);
    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].id, 'playlist-1');
    assert.equal(playlists[0].imageUrl, 'https://img.example.com/playlist.jpg');
    assert.equal(playlists[0].trackCount, 42);
  });

  it('maps shows to DTOs', async () => {
    const { service } = setup({ connection: makeConnection() });
    const shows = await service.listShows(USER_ID);
    assert.equal(shows.length, 1);
    assert.equal(shows[0].publisher, 'BBC');
  });

  it('rejects browsing when Spotify is not connected', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.listPlaylists(USER_ID),
      (error: unknown) => error instanceof SpotifyError && error.code === SpotifyErrorCode.NOT_CONNECTED,
    );
  });
});

describe('SpotifyService.importItem', () => {
  it('imports a playlist as a PLAYLIST resource', async () => {
    const { world, service } = setup({ connection: makeConnection() });
    const resource = await service.importItem(USER_ID, { spotifyId: 'playlist-1', itemType: 'playlist' });
    assert.equal(resource.resourceType, ResourceType.PLAYLIST);
    assert.equal(world.createdResources[0].input.url, 'https://open.spotify.com/playlist/playlist-1');
  });

  it('imports a show as a PODCAST resource', async () => {
    const { service } = setup({ connection: makeConnection() });
    const resource = await service.importItem(USER_ID, { spotifyId: 'show-1', itemType: 'show' });
    assert.equal(resource.resourceType, ResourceType.PODCAST);
  });

  it('rejects import when Spotify is not connected', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.importItem(USER_ID, { spotifyId: 'playlist-1', itemType: 'playlist' }),
      (error: unknown) => error instanceof SpotifyError && error.code === SpotifyErrorCode.NOT_CONNECTED,
    );
  });

  it('rejects an empty spotifyId', async () => {
    const { service } = setup({ connection: makeConnection() });
    await assert.rejects(
      () => service.importItem(USER_ID, { spotifyId: '  ', itemType: 'playlist' }),
      (error: unknown) => error instanceof SpotifyError && error.code === SpotifyErrorCode.INVALID_INPUT,
    );
  });
});
