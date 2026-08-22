import {
  GenerateDailySessionError,
  GenerateDailySessionErrorCode,
} from '../../services/daily-session/generate-daily-session.service';
import { DailySessionError, DailySessionErrorCode } from '../../services/daily-session/daily-sessions.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const GENERATE_DAILY_SESSION_STATUS_BY_CODE: Record<GenerateDailySessionErrorCode, number> = {
  [GenerateDailySessionErrorCode.INVALID_INPUT]: 400,
  [GenerateDailySessionErrorCode.INVALID_TIMEZONE]: 400,
  [GenerateDailySessionErrorCode.AI_RATE_LIMITED]: 429,
  [GenerateDailySessionErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GenerateDailySessionErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GenerateDailySessionErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GenerateDailySessionErrorCode.AI_INVALID_RESPONSE]: 502,
};

const DAILY_SESSION_STATUS_BY_CODE: Record<DailySessionErrorCode, number> = {
  [DailySessionErrorCode.SESSION_NOT_FOUND]: 404,
};

function mapGenerateDailySessionError(error: unknown): unknown {
  if (error instanceof GenerateDailySessionError) {
    return httpError(error.message, GENERATE_DAILY_SESSION_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof DailySessionError) {
    return httpError(error.message, DAILY_SESSION_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapGenerateDailySessionError };
