import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  errorResponse,
  successResponse,
  handleError,
  redirectResponse,
} from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapSpotifyError } from '@lib/spotify/spotify-error-mapper';
import { buildSpotifyServices } from '../services/spotify/spotify-composition';
import type {
  ImportSpotifyItemRequestBody,
  SpotifyConnectionStatusDto,
  SpotifyPlaylistDto,
  SpotifyShowDto,
} from '../interfaces/spotify/spotify.interface';
import type { ResourceDto } from '../interfaces/resources/resources.interface';

interface SpotifyServicePort {
  getAuthorizeUrl(userId: string): string;
  handleCallback(code: string, state: string): Promise<void>;
  getConnectionStatus(userId: string): Promise<SpotifyConnectionStatusDto>;
  disconnect(userId: string): Promise<void>;
  listPlaylists(userId: string): Promise<SpotifyPlaylistDto[]>;
  listShows(userId: string): Promise<SpotifyShowDto[]>;
  importItem(userId: string, input: ImportSpotifyItemRequestBody): Promise<ResourceDto>;
}

interface SpotifyControllerDeps {
  services: () => Promise<{ spotify: SpotifyServicePort }>;
}

const DEFAULT_DEPS: SpotifyControllerDeps = {
  services: buildSpotifyServices,
};

function getFrontendAppUrl(): string {
  return process.env.FRONTEND_APP_URL ?? '';
}

async function connectHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { spotify } = await deps.services();
    const authorizeUrl = spotify.getAuthorizeUrl(payload.sub);
    return successResponse({ success: true, data: { authorizeUrl } }, 200);
  } catch (err: unknown) {
    return handleError(mapSpotifyError(err));
  }
}

export async function connect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return connectHandler(event, DEFAULT_DEPS);
}

async function callbackHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const frontendUrl = getFrontendAppUrl();
  const query = event.queryStringParameters ?? {};

  if (query.error) {
    return redirectResponse(`${frontendUrl}/settings/spotify?connected=false`);
  }

  const code = query.code ?? '';
  const state = query.state ?? '';
  if (!code || !state) {
    return redirectResponse(`${frontendUrl}/settings/spotify?connected=false`);
  }

  try {
    const { spotify } = await deps.services();
    await spotify.handleCallback(code, state);
    return redirectResponse(`${frontendUrl}/settings/spotify?connected=true`);
  } catch {
    return redirectResponse(`${frontendUrl}/settings/spotify?connected=false`);
  }
}

export async function callback(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return callbackHandler(event, DEFAULT_DEPS);
}

async function statusHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { spotify } = await deps.services();
    const result = await spotify.getConnectionStatus(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapSpotifyError(err));
  }
}

export async function status(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return statusHandler(event, DEFAULT_DEPS);
}

async function disconnectHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { spotify } = await deps.services();
    await spotify.disconnect(payload.sub);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(mapSpotifyError(err));
  }
}

export async function disconnect(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return disconnectHandler(event, DEFAULT_DEPS);
}

async function listPlaylistsHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { spotify } = await deps.services();
    const result = await spotify.listPlaylists(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapSpotifyError(err));
  }
}

export async function listPlaylists(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listPlaylistsHandler(event, DEFAULT_DEPS);
}

async function listShowsHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { spotify } = await deps.services();
    const result = await spotify.listShows(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapSpotifyError(err));
  }
}

export async function listShows(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listShowsHandler(event, DEFAULT_DEPS);
}

async function importItemHandler(
  event: APIGatewayProxyEvent,
  deps: SpotifyControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: ImportSpotifyItemRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as ImportSpotifyItemRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { spotify } = await deps.services();
    const resource = await spotify.importItem(payload.sub, body);
    return successResponse({ success: true, data: resource }, 201);
  } catch (err: unknown) {
    return handleError(mapSpotifyError(err));
  }
}

export async function importItem(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return importItemHandler(event, DEFAULT_DEPS);
}

export {
  connectHandler,
  callbackHandler,
  statusHandler,
  disconnectHandler,
  listPlaylistsHandler,
  listShowsHandler,
  importItemHandler,
};
export type { SpotifyControllerDeps, SpotifyServicePort };
