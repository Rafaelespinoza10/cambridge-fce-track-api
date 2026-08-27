import {
  ListMistakesError,
  ListMistakesErrorCode,
} from '../../services/mistakes/list-mistakes.service';

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
  return error;
}

export { mapMistakeError };
