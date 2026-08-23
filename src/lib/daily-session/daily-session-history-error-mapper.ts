import {
  ListDailySessionHistoryError,
  ListDailySessionHistoryErrorCode,
} from '../../services/daily-session/list-daily-session-history.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const LIST_HISTORY_STATUS_BY_CODE: Record<ListDailySessionHistoryErrorCode, number> = {
  [ListDailySessionHistoryErrorCode.INVALID_INPUT]: 400,
};

/**
 * Its own mapper rather than a branch in generate-daily-session-error-mapper.ts:
 * that module imports GenerateDailySessionService, which would drag the whole
 * generation graph into the history Lambda's bundle for one status code. Same
 * split reason as dailySessionHistoryController.ts.
 *
 * An unrecognized error passes through untouched — handleError treats it as a
 * 500 and masks the message.
 */
function mapListDailySessionHistoryError(error: unknown): unknown {
  if (error instanceof ListDailySessionHistoryError) {
    return httpError(error.message, LIST_HISTORY_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapListDailySessionHistoryError };
