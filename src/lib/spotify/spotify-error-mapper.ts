import { SpotifyError, SpotifyErrorCode } from '../../services/spotify/spotify.service';
import { SpotifyApiError } from './spotify-api-client';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const SPOTIFY_STATUS_BY_CODE: Record<SpotifyErrorCode, number> = {
  [SpotifyErrorCode.INVALID_INPUT]: 400,
  [SpotifyErrorCode.INVALID_STATE]: 400,
  [SpotifyErrorCode.NOT_CONNECTED]: 409,
  [SpotifyErrorCode.SPOTIFY_API_ERROR]: 502,
};

/**
 * Translates Spotify's own HTTP status into ours.
 *
 * 401/403 mean the stored grant is no longer usable — the token was revoked,
 * the user removed the app, or the connection was made without a scope the
 * request needs. None of those are retryable, and all of them are fixed by
 * connecting again, so they surface as NOT_CONNECTED's 409, which is exactly
 * what the client already turns into "reconnect your account" rather than
 * "try again".
 *
 * 429 passes through so a caller can honour the rate limit instead of
 * hammering. Everything else is a genuine upstream failure: 502.
 */
function statusFromSpotifyStatus(spotifyStatus: number): number {
  if (spotifyStatus === 401 || spotifyStatus === 403) return 409;
  if (spotifyStatus === 429) return 429;
  return 502;
}

/**
 * An unrecognized error passes through untouched, which handleError renders as
 * a bare 500 with the message masked.
 *
 * That masking is why SpotifyApiError is handled here explicitly. It is thrown
 * by spotify-api-client's `apiGet` on every non-ok response from Spotify, and
 * it is NOT a SpotifyError — so before this branch existed, every real Spotify
 * failure (bad token, missing scope, rate limit, outage) reached the client as
 * an opaque 500 with no message, on endpoints that had a perfectly good 502
 * defined for exactly that case. The message is forwarded deliberately: it
 * carries Spotify's own response body, which is the only thing that says what
 * actually went wrong, and it contains no credentials of ours.
 */
function mapSpotifyError(error: unknown): unknown {
  if (error instanceof SpotifyError) {
    return httpError(error.message, SPOTIFY_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SpotifyApiError) {
    return httpError(error.message, statusFromSpotifyStatus(error.statusCode));
  }
  return error;
}

export { mapSpotifyError };
