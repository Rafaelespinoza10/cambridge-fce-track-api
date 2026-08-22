import {
  StartWritingSubmissionError,
  StartWritingSubmissionErrorCode,
} from '../../services/writing/start-writing-submission.service';
import {
  GetWritingSubmissionError,
  GetWritingSubmissionErrorCode,
} from '../../services/writing/get-writing-submission.service';
import {
  SubmitWritingSubmissionError,
  SubmitWritingSubmissionErrorCode,
} from '../../services/writing/submit-writing-submission.service';
import {
  AbandonWritingSubmissionError,
  AbandonWritingSubmissionErrorCode,
} from '../../services/writing/abandon-writing-submission.service';
import {
  GenerateWritingCorrectionFlashcardDraftError,
  GenerateWritingCorrectionFlashcardDraftErrorCode,
} from '../../services/writing/generate-writing-correction-flashcard-draft.service';
import {
  ListWritingSubmissionHistoryError,
  ListWritingSubmissionHistoryErrorCode,
} from '../../services/writing/list-writing-submission-history.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const START_STATUS_BY_CODE: Record<StartWritingSubmissionErrorCode, number> = {
  [StartWritingSubmissionErrorCode.INVALID_INPUT]: 400,
  [StartWritingSubmissionErrorCode.TASK_NOT_FOUND]: 404,
  [StartWritingSubmissionErrorCode.PLAN_DAY_NOT_FOUND]: 404,
  [StartWritingSubmissionErrorCode.ACTIVE_SUBMISSION_ON_ANOTHER_TASK]: 409,
  [StartWritingSubmissionErrorCode.RACE_UNRESOLVED]: 409,
};

const GET_STATUS_BY_CODE: Record<GetWritingSubmissionErrorCode, number> = {
  [GetWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND]: 404,
};

const SUBMIT_STATUS_BY_CODE: Record<SubmitWritingSubmissionErrorCode, number> = {
  [SubmitWritingSubmissionErrorCode.INVALID_INPUT]: 400,
  [SubmitWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND]: 404,
  [SubmitWritingSubmissionErrorCode.SUBMISSION_ABANDONED]: 409,
  [SubmitWritingSubmissionErrorCode.AI_RATE_LIMITED]: 429,
  [SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE]: 502,
  [SubmitWritingSubmissionErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [SubmitWritingSubmissionErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [SubmitWritingSubmissionErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [SubmitWritingSubmissionErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const ABANDON_STATUS_BY_CODE: Record<AbandonWritingSubmissionErrorCode, number> = {
  [AbandonWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND]: 404,
  [AbandonWritingSubmissionErrorCode.SUBMISSION_GRADED]: 409,
};

const LIST_HISTORY_STATUS_BY_CODE: Record<ListWritingSubmissionHistoryErrorCode, number> = {
  [ListWritingSubmissionHistoryErrorCode.INVALID_INPUT]: 400,
};

const GENERATE_CORRECTION_FLASHCARD_DRAFT_STATUS_BY_CODE: Record<
  GenerateWritingCorrectionFlashcardDraftErrorCode,
  number
> = {
  [GenerateWritingCorrectionFlashcardDraftErrorCode.INVALID_INPUT]: 400,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.SUBMISSION_NOT_FOUND]: 404,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.CORRECTION_NOT_FOUND]: 404,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.SUBMISSION_NOT_GRADED]: 409,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.AI_RATE_LIMITED]: 429,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.AI_INVALID_RESPONSE]: 502,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GenerateWritingCorrectionFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

/**
 * Translates every Writing submission-domain error (start/get/submit/abandon/
 * flashcard-draft/list-history) into an Error with `statusCode`, consumable by
 * @lib/response's handleError. An unrecognized error passes through
 * untouched — handleError treats it as 500 and masks the message, never
 * leaking SQL/constraint names/stack traces. Mirrors mapPracticeAttemptError.
 */
function mapWritingSubmissionError(error: unknown): unknown {
  if (error instanceof StartWritingSubmissionError) {
    return httpError(error.message, START_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GetWritingSubmissionError) {
    return httpError(error.message, GET_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SubmitWritingSubmissionError) {
    return httpError(error.message, SUBMIT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof AbandonWritingSubmissionError) {
    return httpError(error.message, ABANDON_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GenerateWritingCorrectionFlashcardDraftError) {
    return httpError(
      error.message,
      GENERATE_CORRECTION_FLASHCARD_DRAFT_STATUS_BY_CODE[error.code],
    );
  }
  if (error instanceof ListWritingSubmissionHistoryError) {
    return httpError(error.message, LIST_HISTORY_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapWritingSubmissionError };
