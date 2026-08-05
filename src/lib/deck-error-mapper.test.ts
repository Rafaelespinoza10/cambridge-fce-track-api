import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { mapDeckError } from './deck-error-mapper';
import { DeckError, DeckErrorCode } from '../services/decks/decks.service';

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

describe('mapDeckError', () => {
  it('maps INVALID_INPUT to 400', () => {
    const mapped = mapDeckError(new DeckError('bad input', DeckErrorCode.INVALID_INPUT));
    assert.equal(statusOf(mapped), 400);
  });

  it('maps DECK_NOT_FOUND to 404', () => {
    const mapped = mapDeckError(new DeckError('gone', DeckErrorCode.DECK_NOT_FOUND));
    assert.equal(statusOf(mapped), 404);
  });

  it('maps DECK_UPDATE_CONFLICT to 409', () => {
    const mapped = mapDeckError(new DeckError('conflict', DeckErrorCode.DECK_UPDATE_CONFLICT));
    assert.equal(statusOf(mapped), 409);
  });

  it('maps DECK_ARCHIVE_CONFLICT to 409', () => {
    const mapped = mapDeckError(new DeckError('conflict', DeckErrorCode.DECK_ARCHIVE_CONFLICT));
    assert.equal(statusOf(mapped), 409);
  });

  it('maps DECK_DELETE_CONFLICT to 409', () => {
    const mapped = mapDeckError(new DeckError('conflict', DeckErrorCode.DECK_DELETE_CONFLICT));
    assert.equal(statusOf(mapped), 409);
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', () => {
    const mapped = mapDeckError(new DeckError('corrupted', DeckErrorCode.PERSISTENCE_INCONSISTENCY));
    assert.equal(statusOf(mapped), 500);
  });

  it('returns an unrecognized error unchanged, so handleError masks it as a 500', () => {
    const original = new Error('connection terminated unexpectedly');
    const mapped = mapDeckError(original);
    assert.equal(mapped, original);
    assert.equal(statusOf(mapped), undefined);
  });
});
