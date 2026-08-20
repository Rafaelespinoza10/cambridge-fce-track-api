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
import {
  ListPracticeAttemptHistoryError,
  ListPracticeAttemptHistoryErrorCode,
} from '../services/practice/list-practice-attempt-history.service';
import {
  GeneratePracticeErrorFlashcardDraftError,
  GeneratePracticeErrorFlashcardDraftErrorCode,
} from '../services/practice/generate-practice-error-flashcard-draft.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const START_STATUS_BY_CODE: Record<StartPracticeAttemptErrorCode, number> = {
  [StartPracticeAttemptErrorCode.INVALID_INPUT]: 400,
  [StartPracticeAttemptErrorCode.EXERCISE_NOT_FOUND]: 404,
  [StartPracticeAttemptErrorCode.PLAN_DAY_NOT_FOUND]: 404,
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

const LIST_HISTORY_STATUS_BY_CODE: Record<ListPracticeAttemptHistoryErrorCode, number> = {
  [ListPracticeAttemptHistoryErrorCode.INVALID_INPUT]: 400,
  [ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_EXAM]: 400,
  [ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PAPER]: 400,
  [ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PART]: 400,
  [ListPracticeAttemptHistoryErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const GENERATE_ERROR_FLASHCARD_DRAFT_STATUS_BY_CODE: Record<
  GeneratePracticeErrorFlashcardDraftErrorCode,
  number
> = {
  [GeneratePracticeErrorFlashcardDraftErrorCode.INVALID_INPUT]: 400,
  [GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_FOUND]: 404,
  [GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_COMPLETED]: 409,
  [GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_INCORRECT]: 409,
  [GeneratePracticeErrorFlashcardDraftErrorCode.AI_RATE_LIMITED]: 429,
  [GeneratePracticeErrorFlashcardDraftErrorCode.AI_INVALID_RESPONSE]: 502,
  [GeneratePracticeErrorFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GeneratePracticeErrorFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GeneratePracticeErrorFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
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
  if (error instanceof ListPracticeAttemptHistoryError) {
    return httpError(error.message, LIST_HISTORY_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GeneratePracticeErrorFlashcardDraftError) {
    return httpError(error.message, GENERATE_ERROR_FLASHCARD_DRAFT_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapPracticeAttemptError };
