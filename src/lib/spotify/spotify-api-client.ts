const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE_URL = 'https://api.spotify.com/v1';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';
const PAGE_LIMIT = 50;
const MAX_PAGES = 10;

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

/**
 * Nullable where Spotify actually is, not where its docs imply. A playlist
 * with no cover comes back with `images: null` rather than `[]`, and `owner`
 * and `tracks` can both be absent on playlists the account can no longer
 * fully see. Declaring them non-null is what let a single odd playlist crash
 * the whole listing.
 */
interface SpotifyPlaylistItem {
  id: string;
  name: string;
  description: string | null;
  images: SpotifyImage[] | null;
  external_urls: { spotify: string } | null;
  owner: { display_name: string | null } | null;
  tracks: { total: number } | null;
}

interface SpotifyShowItem {
  id: string;
  name: string;
  publisher: string | null;
  description: string | null;
  images: SpotifyImage[] | null;
  external_urls: { spotify: string } | null;
}

/**
 * `items` holds nulls, not just Ts. /me/playlists returns a null entry for a
 * playlist that has become unavailable to the account — a long-standing
 * Spotify behaviour — and collectAllPages drops them.
 */
interface SpotifyPage<T> {
  items: (T | null)[] | null;
  next: string | null;
}

interface SpotifySavedShowItem {
  show: SpotifyShowItem | null;
}

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

interface SpotifyTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope: string;
}

function getConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REDIRECT_URI must be configured',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function requestToken(body: URLSearchParams): Promise<SpotifyTokens> {
  const { clientId, clientSecret } = getConfig();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new SpotifyApiError(`Spotify token request failed: ${text}`, response.status);
  }

  const data = (await response.json()) as SpotifyTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new SpotifyApiError(`Spotify API request failed: ${text}`, response.status);
  }

  return (await response.json()) as T;
}

async function collectAllPages<T>(accessToken: string, firstPageUrl: string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | null = firstPageUrl;
  let pagesFetched = 0;

  while (nextUrl !== null && pagesFetched < MAX_PAGES) {
    const page: SpotifyPage<T> = await apiGet<SpotifyPage<T>>(nextUrl, accessToken);
    // A null entry is not an error, just an item this account can no longer
    // see. Dropping it silently is right: the alternative was a TypeError in
    // the DTO mapper, which surfaced as an opaque 500 for the entire list.
    for (const item of page.items ?? []) {
      if (item !== null && item !== undefined) items.push(item);
    }
    nextUrl = page.next;
    pagesFetched += 1;
  }

  return items;
}

export function getAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<SpotifyTokens> {
  const { redirectUri } = getConfig();
  return requestToken(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  );
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokens> {
  return requestToken(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  );
}

export async function getCurrentUserProfile(accessToken: string): Promise<{ id: string }> {
  return apiGet<{ id: string }>('/me', accessToken);
}

export async function getMyPlaylists(accessToken: string): Promise<SpotifyPlaylistItem[]> {
  return collectAllPages<SpotifyPlaylistItem>(
    accessToken,
    `${API_BASE_URL}/me/playlists?limit=${PAGE_LIMIT}`,
  );
}

export async function getMyShows(accessToken: string): Promise<SpotifyShowItem[]> {
  const saved = await collectAllPages<SpotifySavedShowItem>(
    accessToken,
    `${API_BASE_URL}/me/shows?limit=${PAGE_LIMIT}`,
  );
  return saved
    .map((entry) => entry.show)
    .filter((show): show is SpotifyShowItem => show !== null && show !== undefined);
}

export async function getPlaylistById(
  accessToken: string,
  playlistId: string,
): Promise<SpotifyPlaylistItem> {
  return apiGet<SpotifyPlaylistItem>(`/playlists/${playlistId}`, accessToken);
}

export async function getShowById(accessToken: string, showId: string): Promise<SpotifyShowItem> {
  return apiGet<SpotifyShowItem>(`/shows/${showId}`, accessToken);
}

export type { SpotifyPlaylistItem, SpotifyShowItem, SpotifyImage, SpotifyTokens };
