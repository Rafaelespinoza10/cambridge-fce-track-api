import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { mapFlashcardProgressError } from './flashcard-progress-error-mapper';
import {
  FlashcardProgressError,
  FlashcardProgressErrorCode,
} from '../../services/flashcards/flashcard-progress.service';

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

describe('mapFlashcardProgressError', () => {
  it('maps INVALID_INPUT to 400', () => {
    const mapped = mapFlashcardProgressError(
      new FlashcardProgressError('bad input', FlashcardProgressErrorCode.INVALID_INPUT),
    );
    assert.equal(statusOf(mapped), 400);
  });

  it('maps USER_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardProgressError(
      new FlashcardProgressError('gone', FlashcardProgressErrorCode.USER_NOT_FOUND),
    );
    assert.equal(statusOf(mapped), 404);
  });

  it('maps PROFILE_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardProgressError(
      new FlashcardProgressError('gone', FlashcardProgressErrorCode.PROFILE_NOT_FOUND),
    );
    assert.equal(statusOf(mapped), 404);
  });

  it('maps INVALID_TIMEZONE to 400', () => {
    const mapped = mapFlashcardProgressError(
      new FlashcardProgressError('bad tz', FlashcardProgressErrorCode.INVALID_TIMEZONE),
    );
    assert.equal(statusOf(mapped), 400);
  });

  it('maps PREFERENCES_UPDATE_CONFLICT to 409', () => {
    const mapped = mapFlashcardProgressError(
      new FlashcardProgressError('conflict', FlashcardProgressErrorCode.PREFERENCES_UPDATE_CONFLICT),
    );
    assert.equal(statusOf(mapped), 409);
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', () => {
    const mapped = mapFlashcardProgressError(
      new FlashcardProgressError(
        'corrupted',
        FlashcardProgressErrorCode.PERSISTENCE_INCONSISTENCY,
      ),
    );
    assert.equal(statusOf(mapped), 500);
  });

  it('returns an unrecognized error unchanged, so handleError masks it as a 500', () => {
    const original = new Error('connection terminated unexpectedly');
    const mapped = mapFlashcardProgressError(original);
    assert.equal(mapped, original);
    assert.equal(statusOf(mapped), undefined);
  });
});
