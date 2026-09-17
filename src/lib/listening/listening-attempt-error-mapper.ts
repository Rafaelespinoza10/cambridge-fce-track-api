import {
  GetListeningSourceError,
  GetListeningSourceErrorCode,
} from '../../services/listening/get-listening-source.service';
import {
  StartListeningAttemptError,
  StartListeningAttemptErrorCode,
} from '../../services/listening/start-listening-attempt.service';
import {
  SubmitListeningAttemptError,
  SubmitListeningAttemptErrorCode,
} from '../../services/listening/submit-listening-attempt.service';
import {
  GetListeningAttemptError,
  GetListeningAttemptErrorCode,
} from '../../services/listening/get-listening-attempt.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const GET_SOURCE_STATUS_BY_CODE: Record<GetListeningSourceErrorCode, number> = {
  [GetListeningSourceErrorCode.SOURCE_NOT_FOUND]: 404,
};

const START_STATUS_BY_CODE: Record<StartListeningAttemptErrorCode, number> = {
  [StartListeningAttemptErrorCode.INVALID_INPUT]: 400,
  [StartListeningAttemptErrorCode.SOURCE_NOT_FOUND]: 404,
};

const SUBMIT_STATUS_BY_CODE: Record<SubmitListeningAttemptErrorCode, number> = {
  [SubmitListeningAttemptErrorCode.INVALID_INPUT]: 400,
  [SubmitListeningAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [SubmitListeningAttemptErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const GET_ATTEMPT_STATUS_BY_CODE: Record<GetListeningAttemptErrorCode, number> = {
  [GetListeningAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
};

/**
 * Translates every Listening attempt-domain error (get source/start/submit/
 * get attempt) into an Error with `statusCode`, consumable by @lib/response's
 * handleError. An unrecognized error passes through untouched — handleError
 * treats it as 500 and masks the message, never leaking SQL/constraint
 * names/stack traces.
 */
function mapListeningAttemptError(error: unknown): unknown {
  if (error instanceof GetListeningSourceError) {
    return httpError(error.message, GET_SOURCE_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof StartListeningAttemptError) {
    return httpError(error.message, START_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SubmitListeningAttemptError) {
    return httpError(error.message, SUBMIT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GetListeningAttemptError) {
    return httpError(error.message, GET_ATTEMPT_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapListeningAttemptError };
