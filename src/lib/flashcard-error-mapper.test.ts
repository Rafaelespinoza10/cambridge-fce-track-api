import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { mapFlashcardError } from './flashcard-error-mapper';
import { FlashcardError, FlashcardErrorCode } from '../services/flashcards.service';

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

describe('mapFlashcardError', () => {
  it('maps INVALID_INPUT to 400', () => {
    const mapped = mapFlashcardError(new FlashcardError('bad input', FlashcardErrorCode.INVALID_INPUT));
    assert.equal(statusOf(mapped), 400);
  });

  it('maps DECK_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardError(new FlashcardError('gone', FlashcardErrorCode.DECK_NOT_FOUND));
    assert.equal(statusOf(mapped), 404);
  });

  it('maps DECK_UNAVAILABLE to 404', () => {
    const mapped = mapFlashcardError(
      new FlashcardError('archived', FlashcardErrorCode.DECK_UNAVAILABLE),
    );
    assert.equal(statusOf(mapped), 404);
  });

  it('maps FLASHCARD_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardError(
      new FlashcardError('gone', FlashcardErrorCode.FLASHCARD_NOT_FOUND),
    );
    assert.equal(statusOf(mapped), 404);
  });

  it('maps FLASHCARD_DUPLICATE to 409', () => {
    const mapped = mapFlashcardError(
      new FlashcardError('dup', FlashcardErrorCode.FLASHCARD_DUPLICATE),
    );
    assert.equal(statusOf(mapped), 409);
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', () => {
    const mapped = mapFlashcardError(
      new FlashcardError('corrupted', FlashcardErrorCode.PERSISTENCE_INCONSISTENCY),
    );
    assert.equal(statusOf(mapped), 500);
  });

  it('returns an unrecognized error unchanged, so handleError masks it as a 500', () => {
    const original = new Error('connection terminated unexpectedly');
    const mapped = mapFlashcardError(original);
    assert.equal(mapped, original);
    assert.equal(statusOf(mapped), undefined);
  });
});
