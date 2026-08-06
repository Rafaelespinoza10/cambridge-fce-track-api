import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { mapPracticeAttemptError } from './practice-attempt-error-mapper';
import {
  StartPracticeAttemptError,
  StartPracticeAttemptErrorCode,
} from '../services/practice/start-practice-attempt.service';
import {
  GetPracticeAttemptError,
  GetPracticeAttemptErrorCode,
} from '../services/practice/get-practice-attempt.service';
import {
  SubmitPracticeAttemptError,
  SubmitPracticeAttemptErrorCode,
} from '../services/practice/submit-practice-attempt.service';
import {
  AbandonPracticeAttemptError,
  AbandonPracticeAttemptErrorCode,
} from '../services/practice/abandon-practice-attempt.service';

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

describe('mapPracticeAttemptError — unrecognized errors', () => {
  it('passes an unrecognized error through untouched (masked as 500 by handleError)', () => {
    const original = new Error('ECONNREFUSED');
    assert.equal(mapPracticeAttemptError(original), original);
  });
});
