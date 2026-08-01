import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { mapFlashcardReviewError } from './flashcard-review-error-mapper';
import { FlashcardReviewError, FlashcardReviewErrorCode } from '../services/flashcard-review.service';
import {
  StartFlashcardReviewSessionError,
  StartFlashcardReviewSessionErrorCode,
} from '../services/start-flashcard-review-session.service';
import {
  CompleteFlashcardReviewSessionError,
  CompleteFlashcardReviewSessionErrorCode,
} from '../services/complete-flashcard-review-session.service';
import { SchedulingError } from '../services/flashcard-scheduling/scheduling.types';

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

describe('mapFlashcardReviewError — 400 family', () => {
  it('maps FlashcardReviewErrorCode.INVALID_INPUT to 400', () => {
    const mapped = mapFlashcardReviewError(
      new FlashcardReviewError('bad input', FlashcardReviewErrorCode.INVALID_INPUT),
    );
    assert.equal(statusOf(mapped), 400);
  });

  it('maps StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE to 400', () => {
    const mapped = mapFlashcardReviewError(
      new StartFlashcardReviewSessionError(
        'bad tz',
        StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE,
      ),
    );
    assert.equal(statusOf(mapped), 400);
  });
});

describe('mapFlashcardReviewError — 404 family', () => {
  it('maps FlashcardReviewErrorCode.SESSION_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardReviewError(
      new FlashcardReviewError('gone', FlashcardReviewErrorCode.SESSION_NOT_FOUND),
    );
    assert.equal(statusOf(mapped), 404);
  });

  it('maps StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardReviewError(
      new StartFlashcardReviewSessionError(
        'no user',
        StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND,
      ),
    );
    assert.equal(statusOf(mapped), 404);
  });

  it('maps CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND to 404', () => {
    const mapped = mapFlashcardReviewError(
      new CompleteFlashcardReviewSessionError(
        'gone',
        CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND,
      ),
    );
    assert.equal(statusOf(mapped), 404);
  });
});

describe('mapFlashcardReviewError — 409 family', () => {
  it('maps FlashcardReviewErrorCode.FLASHCARD_SUSPENDED to 409', () => {
    const mapped = mapFlashcardReviewError(
      new FlashcardReviewError('suspended', FlashcardReviewErrorCode.FLASHCARD_SUSPENDED),
    );
    assert.equal(statusOf(mapped), 409);
  });

  it('maps CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_LAST_REVIEW to 409', () => {
    const mapped = mapFlashcardReviewError(
      new CompleteFlashcardReviewSessionError(
        'too early',
        CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_LAST_REVIEW,
      ),
    );
    assert.equal(statusOf(mapped), 409);
  });

  it('maps StartFlashcardReviewSessionErrorCode.SESSION_RACE_UNRESOLVED to 409', () => {
    const mapped = mapFlashcardReviewError(
      new StartFlashcardReviewSessionError(
        'race',
        StartFlashcardReviewSessionErrorCode.SESSION_RACE_UNRESOLVED,
      ),
    );
    assert.equal(statusOf(mapped), 409);
  });

  it('maps a SchedulingError to 409', () => {
    const mapped = mapFlashcardReviewError(new SchedulingError('invalid scheduling state'));
    assert.equal(statusOf(mapped), 409);
  });
});

describe('mapFlashcardReviewError — 500 family', () => {
  it('maps FlashcardReviewErrorCode.INVALID_EASE_FACTOR to 500', () => {
    const mapped = mapFlashcardReviewError(
      new FlashcardReviewError('bad ease', FlashcardReviewErrorCode.INVALID_EASE_FACTOR),
    );
    assert.equal(statusOf(mapped), 500);
  });

  it('maps CompleteFlashcardReviewSessionErrorCode.PERSISTENCE_INCONSISTENCY to 500', () => {
    const mapped = mapFlashcardReviewError(
      new CompleteFlashcardReviewSessionError(
        'corrupted',
        CompleteFlashcardReviewSessionErrorCode.PERSISTENCE_INCONSISTENCY,
      ),
    );
    assert.equal(statusOf(mapped), 500);
  });
});

describe('mapFlashcardReviewError — unrecognized errors', () => {
  it('returns an unrecognized error unchanged, so handleError treats it as a masked 500', () => {
    const original = new Error('connection terminated unexpectedly');
    const mapped = mapFlashcardReviewError(original);
    assert.equal(mapped, original);
    assert.equal(statusOf(mapped), undefined);
  });
});
