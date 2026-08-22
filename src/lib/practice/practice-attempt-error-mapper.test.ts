import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { mapPracticeAttemptError } from './practice-attempt-error-mapper';
import {
  StartPracticeAttemptError,
  StartPracticeAttemptErrorCode,
} from '../../services/practice/start-practice-attempt.service';
import {
  GetPracticeAttemptError,
  GetPracticeAttemptErrorCode,
} from '../../services/practice/get-practice-attempt.service';
import {
  SubmitPracticeAttemptError,
  SubmitPracticeAttemptErrorCode,
} from '../../services/practice/submit-practice-attempt.service';
import {
  AbandonPracticeAttemptError,
  AbandonPracticeAttemptErrorCode,
} from '../../services/practice/abandon-practice-attempt.service';
import {
  ListPracticeAttemptHistoryError,
  ListPracticeAttemptHistoryErrorCode,
} from '../../services/practice/list-practice-attempt-history.service';
import {
  GeneratePracticeErrorFlashcardDraftError,
  GeneratePracticeErrorFlashcardDraftErrorCode,
} from '../../services/practice/generate-practice-error-flashcard-draft.service';

function statusOf(error: unknown): number | undefined {
  return (error as { statusCode?: number }).statusCode;
}

describe('mapPracticeAttemptError — start', () => {
  it('maps INVALID_INPUT to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new StartPracticeAttemptError('x', StartPracticeAttemptErrorCode.INVALID_INPUT),
        ),
      ),
      400,
    );
  });

  it('maps EXERCISE_NOT_FOUND to 404', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new StartPracticeAttemptError('x', StartPracticeAttemptErrorCode.EXERCISE_NOT_FOUND),
        ),
      ),
      404,
    );
  });

  it('maps ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE to 409', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new StartPracticeAttemptError(
            'x',
            StartPracticeAttemptErrorCode.ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE,
          ),
        ),
      ),
      409,
    );
  });

  it('maps RACE_UNRESOLVED to 409', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new StartPracticeAttemptError('x', StartPracticeAttemptErrorCode.RACE_UNRESOLVED),
        ),
      ),
      409,
    );
  });
});

describe('mapPracticeAttemptError — get', () => {
  it('maps ATTEMPT_NOT_FOUND to 404', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GetPracticeAttemptError('x', GetPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND),
        ),
      ),
      404,
    );
  });
});

describe('mapPracticeAttemptError — submit', () => {
  it('maps INVALID_INPUT to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new SubmitPracticeAttemptError('x', SubmitPracticeAttemptErrorCode.INVALID_INPUT),
        ),
      ),
      400,
    );
  });

  it('maps ATTEMPT_NOT_FOUND to 404', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new SubmitPracticeAttemptError('x', SubmitPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND),
        ),
      ),
      404,
    );
  });

  it('maps ATTEMPT_ABANDONED to 409', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new SubmitPracticeAttemptError('x', SubmitPracticeAttemptErrorCode.ATTEMPT_ABANDONED),
        ),
      ),
      409,
    );
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new SubmitPracticeAttemptError(
            'x',
            SubmitPracticeAttemptErrorCode.PERSISTENCE_INCONSISTENCY,
          ),
        ),
      ),
      500,
    );
  });
});

describe('mapPracticeAttemptError — abandon', () => {
  it('maps ATTEMPT_NOT_FOUND to 404', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new AbandonPracticeAttemptError('x', AbandonPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND),
        ),
      ),
      404,
    );
  });

  it('maps ATTEMPT_COMPLETED to 409', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new AbandonPracticeAttemptError('x', AbandonPracticeAttemptErrorCode.ATTEMPT_COMPLETED),
        ),
      ),
      409,
    );
  });
});

describe('mapPracticeAttemptError — list history', () => {
  it('maps INVALID_INPUT to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new ListPracticeAttemptHistoryError(
            'x',
            ListPracticeAttemptHistoryErrorCode.INVALID_INPUT,
          ),
        ),
      ),
      400,
    );
  });

  it('maps UNSUPPORTED_EXAM to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new ListPracticeAttemptHistoryError(
            'x',
            ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_EXAM,
          ),
        ),
      ),
      400,
    );
  });

  it('maps UNSUPPORTED_PAPER to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new ListPracticeAttemptHistoryError(
            'x',
            ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PAPER,
          ),
        ),
      ),
      400,
    );
  });

  it('maps UNSUPPORTED_PART to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new ListPracticeAttemptHistoryError(
            'x',
            ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PART,
          ),
        ),
      ),
      400,
    );
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new ListPracticeAttemptHistoryError(
            'x',
            ListPracticeAttemptHistoryErrorCode.PERSISTENCE_INCONSISTENCY,
          ),
        ),
      ),
      500,
    );
  });
});

describe('mapPracticeAttemptError — generate error flashcard draft', () => {
  it('maps INVALID_INPUT to 400', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.INVALID_INPUT,
          ),
        ),
      ),
      400,
    );
  });

  it('maps ATTEMPT_NOT_FOUND to 404', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_FOUND,
          ),
        ),
      ),
      404,
    );
  });

  it('maps PRACTICE_ITEM_NOT_FOUND to 404', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_FOUND,
          ),
        ),
      ),
      404,
    );
  });

  it('maps ATTEMPT_NOT_COMPLETED to 409', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_COMPLETED,
          ),
        ),
      ),
      409,
    );
  });

  it('maps PRACTICE_ITEM_NOT_INCORRECT to 409', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_INCORRECT,
          ),
        ),
      ),
      409,
    );
  });

  it('maps AI_RATE_LIMITED to 429', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.AI_RATE_LIMITED,
          ),
        ),
      ),
      429,
    );
  });

  it('maps AI_INVALID_RESPONSE to 502', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
          ),
        ),
      ),
      502,
    );
  });

  it('maps AI_PROVIDER_UNAVAILABLE to 503', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
          ),
        ),
      ),
      503,
    );
  });

  it('maps AI_REQUEST_TIMEOUT to 504', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
          ),
        ),
      ),
      504,
    );
  });

  it('maps AI_CONFIGURATION_ERROR to 500', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
          ),
        ),
      ),
      500,
    );
  });

  it('maps PERSISTENCE_INCONSISTENCY to 500', () => {
    assert.equal(
      statusOf(
        mapPracticeAttemptError(
          new GeneratePracticeErrorFlashcardDraftError(
            'x',
            GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
          ),
        ),
      ),
      500,
    );
  });
});

describe('mapPracticeAttemptError — unrecognized errors', () => {
  it('passes an unrecognized error through untouched (masked as 500 by handleError)', () => {
    const original = new Error('ECONNREFUSED');
    assert.equal(mapPracticeAttemptError(original), original);
  });
});
