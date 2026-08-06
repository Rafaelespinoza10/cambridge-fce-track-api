import {
  StartPracticeAttemptError,
  StartPracticeAttemptErrorCode,
} from '../services/practice/start-practice-attempt.service';
import {
  GetPracticeAttemptError,
  GetPracticeAttemptErrorCode,
} from '../services/practice/get-practice-attempt.service';
import {
  SubmitPracticeAttemptError,
  SubmitPracticeAttemptErrorCode,
} from '../services/practice/submit-practice-attempt.service';
import {
  AbandonPracticeAttemptError,
  AbandonPracticeAttemptErrorCode,
} from '../services/practice/abandon-practice-attempt.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const START_STATUS_BY_CODE: Record<StartPracticeAttemptErrorCode, number> = {
  [StartPracticeAttemptErrorCode.INVALID_INPUT]: 400,
  [StartPracticeAttemptErrorCode.EXERCISE_NOT_FOUND]: 404,
  [StartPracticeAttemptErrorCode.ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE]: 409,
  [StartPracticeAttemptErrorCode.RACE_UNRESOLVED]: 409,
};

const GET_STATUS_BY_CODE: Record<GetPracticeAttemptErrorCode, number> = {
  [GetPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
};

const SUBMIT_STATUS_BY_CODE: Record<SubmitPracticeAttemptErrorCode, number> = {
  [SubmitPracticeAttemptErrorCode.INVALID_INPUT]: 400,
  [SubmitPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [SubmitPracticeAttemptErrorCode.ATTEMPT_ABANDONED]: 409,
  [SubmitPracticeAttemptErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const ABANDON_STATUS_BY_CODE: Record<AbandonPracticeAttemptErrorCode, number> = {
  [AbandonPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [AbandonPracticeAttemptErrorCode.ATTEMPT_COMPLETED]: 409,
};

/**
 * Translates every Practice attempt-domain error (start/get/submit/abandon)
 * into an Error with `statusCode`, consumable by @lib/response's
 * handleError. An unrecognized error passes through untouched — handleError
 * treats it as 500 and masks the message, never leaking SQL/constraint
 * names/stack traces.
 */
function mapPracticeAttemptError(error: unknown): unknown {
  if (error instanceof StartPracticeAttemptError) {
    return httpError(error.message, START_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GetPracticeAttemptError) {
    return httpError(error.message, GET_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SubmitPracticeAttemptError) {
    return httpError(error.message, SUBMIT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof AbandonPracticeAttemptError) {
    return httpError(error.message, ABANDON_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapPracticeAttemptError };
