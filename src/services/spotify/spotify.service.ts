import type { DataSource } from 'typeorm';

import { SpotifyConnectionRepository } from '@repositories/spotify/spotify-connection.repository';
import type {
  UpsertSpotifyConnectionData,
  UpdateSpotifyConnectionTokensData,
} from '@repositories/spotify/spotify-connection.repository';
import * as spotifyApiClient from '@lib/spotify/spotify-api-client';
import type {
  SpotifyPlaylistItem,
  SpotifyShowItem,
  SpotifyTokens,
} from '@lib/spotify/spotify-api-client';
import { JwtService } from '@lib/shared/jwt';
import { encrypt } from '@lib/shared/crypto';
import { ResourceType } from '@models/enums';
import type { SpotifyConnection } from '@models/SpotifyConnection';
import { ResourcesService } from '../resources/resources.service';
import { SpotifyTokenManager } from './spotify-token-manager';
import type {
  ImportSpotifyItemRequestBody,
  SpotifyConnectionStatusDto,
  SpotifyPlaylistDto,
  SpotifyShowDto,
} from '../../interfaces/spotify/spotify.interface';
import type { ResourceDto } from '../../interfaces/resources/resources.interface';

export enum SpotifyErrorCode {
  INVALID_INPUT = 'invalid_input',
  INVALID_STATE = 'invalid_state',
  NOT_CONNECTED = 'not_connected',
  SPOTIFY_API_ERROR = 'spotify_api_error',
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly code: SpotifyErrorCode,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

const STATE_PURPOSE = 'spotify_connect';

interface SpotifyConnectionRepositoryPort {
  findByUserId(userId: string): Promise<SpotifyConnection | null>;
  upsert(data: UpsertSpotifyConnectionData): Promise<void>;
  updateTokens(userId: string, data: UpdateSpotifyConnectionTokensData): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}

interface SpotifyClientPort {
  getAuthorizeUrl(state: string): string;
  exchangeCodeForTokens(code: string): Promise<SpotifyTokens>;
  refreshAccessToken(refreshToken: string): Promise<SpotifyTokens>;
  getCurrentUserProfile(accessToken: string): Promise<{ id: string }>;
  getMyPlaylists(accessToken: string): Promise<SpotifyPlaylistItem[]>;
  getMyShows(accessToken: string): Promise<SpotifyShowItem[]>;
  getPlaylistById(accessToken: string, playlistId: string): Promise<SpotifyPlaylistItem>;
  getShowById(accessToken: string, showId: string): Promise<SpotifyShowItem>;
}

interface ResourcesServicePort {
  createResource(
    userId: string,
    input: {
      title: string;
      url: string;
      description?: string;
      resourceType?: ResourceType;
      imageUrl?: string;
    },
  ): Promise<ResourceDto>;
}

interface SpotifyServiceDeps {
  connections: (dataSource: DataSource) => SpotifyConnectionRepositoryPort;
  spotifyClient: SpotifyClientPort;
  resources: (dataSource: DataSource) => ResourcesServicePort;
}

const DEFAULT_DEPS: SpotifyServiceDeps = {
  connections: (dataSource) => new SpotifyConnectionRepository(dataSource),
  spotifyClient: spotifyApiClient,
  resources: (dataSource) => new ResourcesService(dataSource),
};

function toPlaylistDto(item: SpotifyPlaylistItem): SpotifyPlaylistDto {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    imageUrl: item.images[0]?.url ?? null,
    externalUrl: item.external_urls.spotify,
    ownerName: item.owner.display_name ?? 'Unknown',
    trackCount: item.tracks.total,
  };
}

function toShowDto(item: SpotifyShowItem): SpotifyShowDto {
  return {
    id: item.id,
    name: item.name,
    publisher: item.publisher,
    description: item.description,
    imageUrl: item.images[0]?.url ?? null,
    externalUrl: item.external_urls.spotify,
  };
}

function normalizeSpotifyId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SpotifyError('spotifyId must be a non-empty string', SpotifyErrorCode.INVALID_INPUT);
  }
  return value.trim();
}

class SpotifyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SpotifyServiceDeps = DEFAULT_DEPS,
  ) {}

  private connectionsRepo(): SpotifyConnectionRepositoryPort {
    return this.deps.connections(this.dataSource);
  }

  private resourcesService(): ResourcesServicePort {
    return this.deps.resources(this.dataSource);
  }

  private tokenManager(): SpotifyTokenManager {
    const repo = this.connectionsRepo();
    return new SpotifyTokenManager({
      refreshAccessToken: (refreshToken) =>
        this.deps.spotifyClient.refreshAccessToken(refreshToken),
      persistTokens: (userId, data) =>
        repo.updateTokens(userId, {
          accessTokenEncrypted: data.accessTokenEncrypted,
          refreshTokenEncrypted: data.refreshTokenEncrypted,
          tokenExpiresAt: data.expiresAt,
        }),
    });
  }

  private async requireAccessToken(userId: string): Promise<string> {
    const connection = await this.connectionsRepo().findByUserId(userId);
    if (connection === null) {
      throw new SpotifyError('Spotify is not connected', SpotifyErrorCode.NOT_CONNECTED);
    }
    return this.tokenManager().getValidAccessToken(connection);
  }

  getAuthorizeUrl(userId: string): string {
    const state = JwtService.signState({ userId, purpose: STATE_PURPOSE });
    return this.deps.spotifyClient.getAuthorizeUrl(state);
  }

  async handleCallback(code: string, state: string): Promise<void> {
    let statePayload;
    try {
      statePayload = JwtService.verifyState(state);
    } catch {
      throw new SpotifyError('Invalid or expired state', SpotifyErrorCode.INVALID_STATE);
    }
    if (statePayload.purpose !== STATE_PURPOSE) {
      throw new SpotifyError('Invalid state', SpotifyErrorCode.INVALID_STATE);
    }

    const tokens = await this.deps.spotifyClient.exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      throw new SpotifyError(
        'Spotify did not return a refresh token',
        SpotifyErrorCode.SPOTIFY_API_ERROR,
      );
    }
    const profile = await this.deps.spotifyClient.getCurrentUserProfile(tokens.accessToken);

    await this.connectionsRepo().upsert({
      userId: statePayload.userId,
      spotifyUserId: profile.id,
      accessTokenEncrypted: encrypt(tokens.accessToken),
      refreshTokenEncrypted: encrypt(tokens.refreshToken),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      scope: tokens.scope ?? null,
    });
  }

  async getConnectionStatus(userId: string): Promise<SpotifyConnectionStatusDto> {
    const connection = await this.connectionsRepo().findByUserId(userId);
    if (connection === null) return { connected: false };
    return {
      connected: true,
      spotifyUserId: connection.spotify_user_id,
      scope: connection.scope ?? undefined,
      connectedAt: connection.created_at,
    };
  }

  async disconnect(userId: string): Promise<void> {
    await this.connectionsRepo().deleteByUserId(userId);
  }

  async listPlaylists(userId: string): Promise<SpotifyPlaylistDto[]> {
    const accessToken = await this.requireAccessToken(userId);
    const playlists = await this.deps.spotifyClient.getMyPlaylists(accessToken);
    return playlists.map(toPlaylistDto);
  }

  async listShows(userId: string): Promise<SpotifyShowDto[]> {
    const accessToken = await this.requireAccessToken(userId);
    const shows = await this.deps.spotifyClient.getMyShows(accessToken);
    return shows.map(toShowDto);
  }

  async importItem(userId: string, input: ImportSpotifyItemRequestBody): Promise<ResourceDto> {
    const spotifyId = normalizeSpotifyId(input.spotifyId);
    const accessToken = await this.requireAccessToken(userId);

    if (input.itemType === 'playlist') {
      const item = await this.deps.spotifyClient.getPlaylistById(accessToken, spotifyId);
      const dto = toPlaylistDto(item);
      return this.resourcesService().createResource(userId, {
        title: dto.name,
        description: dto.description ?? undefined,
        url: dto.externalUrl,
        resourceType: ResourceType.PLAYLIST,
        imageUrl: dto.imageUrl ?? undefined,
      });
    }

    if (input.itemType === 'show') {
      const item = await this.deps.spotifyClient.getShowById(accessToken, spotifyId);
      const dto = toShowDto(item);
      return this.resourcesService().createResource(userId, {
        title: dto.name,
        description: dto.description ?? undefined,
        url: dto.externalUrl,
        resourceType: ResourceType.PODCAST,
        imageUrl: dto.imageUrl ?? undefined,
      });
    }

    throw new SpotifyError('itemType must be "playlist" or "show"', SpotifyErrorCode.INVALID_INPUT);
  }
}

export { SpotifyService };
export type {
  SpotifyConnectionRepositoryPort,
  SpotifyClientPort,
  ResourcesServicePort,
  SpotifyServiceDeps,
};
