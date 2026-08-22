import {
  StartDailySessionSubmissionError,
  StartDailySessionSubmissionErrorCode,
} from '../../services/daily-session/start-daily-session-submission.service';
import {
  SubmitDailySessionSubmissionError,
  SubmitDailySessionSubmissionErrorCode,
} from '../../services/daily-session/submit-daily-session-submission.service';
import {
  DailySessionSubmissionError,
  DailySessionSubmissionErrorCode,
} from '../../services/daily-session/get-daily-session-submission.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const START_STATUS_BY_CODE: Record<StartDailySessionSubmissionErrorCode, number> = {
  [StartDailySessionSubmissionErrorCode.INVALID_INPUT]: 400,
  [StartDailySessionSubmissionErrorCode.SESSION_NOT_FOUND]: 404,
};

const SUBMIT_STATUS_BY_CODE: Record<SubmitDailySessionSubmissionErrorCode, number> = {
  [SubmitDailySessionSubmissionErrorCode.INVALID_INPUT]: 400,
  [SubmitDailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND]: 404,
  [SubmitDailySessionSubmissionErrorCode.SUBMISSION_ABANDONED]: 409,
  [SubmitDailySessionSubmissionErrorCode.AI_RATE_LIMITED]: 429,
  [SubmitDailySessionSubmissionErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [SubmitDailySessionSubmissionErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [SubmitDailySessionSubmissionErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [SubmitDailySessionSubmissionErrorCode.AI_INVALID_RESPONSE]: 502,
  [SubmitDailySessionSubmissionErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const GET_STATUS_BY_CODE: Record<DailySessionSubmissionErrorCode, number> = {
  [DailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND]: 404,
};

function mapDailySessionSubmissionError(error: unknown): unknown {
  if (error instanceof StartDailySessionSubmissionError) {
    return httpError(error.message, START_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SubmitDailySessionSubmissionError) {
    return httpError(error.message, SUBMIT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof DailySessionSubmissionError) {
    return httpError(error.message, GET_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapDailySessionSubmissionError };
