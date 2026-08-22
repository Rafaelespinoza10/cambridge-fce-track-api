import { SpotifyError, SpotifyErrorCode } from '../../services/spotify/spotify.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const SPOTIFY_STATUS_BY_CODE: Record<SpotifyErrorCode, number> = {
  [SpotifyErrorCode.INVALID_INPUT]: 400,
  [SpotifyErrorCode.INVALID_STATE]: 400,
  [SpotifyErrorCode.NOT_CONNECTED]: 409,
  [SpotifyErrorCode.SPOTIFY_API_ERROR]: 502,
};

function mapSpotifyError(error: unknown): unknown {
  if (error instanceof SpotifyError) {
    return httpError(error.message, SPOTIFY_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapSpotifyError };
