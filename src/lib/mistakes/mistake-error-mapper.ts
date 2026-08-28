import {
  ListMistakesError,
  ListMistakesErrorCode,
} from '../../services/mistakes/list-mistakes.service';
import {
  ListWeaknessesError,
  ListWeaknessesErrorCode,
} from '../../services/mistakes/list-weaknesses.service';
import {
  ListReviewsError,
  ListReviewsErrorCode,
} from '../../services/mistakes/list-due-reviews.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const LIST_STATUS_BY_CODE: Record<ListMistakesErrorCode, number> = {
  [ListMistakesErrorCode.INVALID_INPUT]: 400,
  [ListMistakesErrorCode.UNSUPPORTED_SKILL]: 400,
  [ListMistakesErrorCode.UNSUPPORTED_EXAM]: 400,
  [ListMistakesErrorCode.UNSUPPORTED_PAPER]: 400,
  [ListMistakesErrorCode.UNSUPPORTED_PART]: 400,
};

/** Every weakness filter error is a client mistake — there is no 404: an unknown pattern is simply an empty list. */
const WEAKNESSES_STATUS_BY_CODE: Record<ListWeaknessesErrorCode, number> = {
  [ListWeaknessesErrorCode.INVALID_INPUT]: 400,
  [ListWeaknessesErrorCode.UNSUPPORTED_SKILL]: 400,
  [ListWeaknessesErrorCode.UNSUPPORTED_EXAM]: 400,
  [ListWeaknessesErrorCode.UNSUPPORTED_PAPER]: 400,
  [ListWeaknessesErrorCode.UNSUPPORTED_PART]: 400,
};

/** The reviews listing only ever rejects a malformed filter. */
const REVIEWS_STATUS_BY_CODE: Record<ListReviewsErrorCode, number> = {
  [ListReviewsErrorCode.INVALID_INPUT]: 400,
};

/**
 * Translates Mistake Bank domain errors into an Error carrying `statusCode`,
 * consumable by @lib/shared/response's handleError. Anything unrecognized
 * passes through untouched — handleError turns it into a 500 and masks the
 * message, never leaking SQL or constraint names.
 */
function mapMistakeError(error: unknown): unknown {
  if (error instanceof ListMistakesError) {
    return httpError(error.message, LIST_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof ListWeaknessesError) {
    return httpError(error.message, WEAKNESSES_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof ListReviewsError) {
    return httpError(error.message, REVIEWS_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapMistakeError };
