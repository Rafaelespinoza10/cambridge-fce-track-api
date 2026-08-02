import { DeckError, DeckErrorCode } from '../services/decks.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const DECK_STATUS_BY_CODE: Record<DeckErrorCode, number> = {
  [DeckErrorCode.INVALID_INPUT]: 400,
  [DeckErrorCode.DECK_NOT_FOUND]: 404,
  [DeckErrorCode.DECK_UPDATE_CONFLICT]: 409,
  [DeckErrorCode.DECK_ARCHIVE_CONFLICT]: 409,
  [DeckErrorCode.DECK_DELETE_CONFLICT]: 409,
  [DeckErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};


function mapDeckError(error: unknown): unknown {
  if (error instanceof DeckError) {
    return httpError(error.message, DECK_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapDeckError };
