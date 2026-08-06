import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AbandonPracticeAttemptService,
  AbandonPracticeAttemptError,
  AbandonPracticeAttemptErrorCode,
} from './abandon-practice-attempt.service';
import type { PracticeAttemptsRepositoryPort } from './abandon-practice-attempt.service';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import { PracticeAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-id';

function makeAttempt(status: PracticeAttemptStatus): PracticeAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    exercise_id: 'exercise-id',
    status,
    started_at: new Date(),
    total_count: 8,
  } as unknown as PracticeAttempt;
}

interface Overrides {
  findByIdForUser?: PracticeAttemptsRepositoryPort['findByIdForUser'];
  abandonAttempt?: PracticeAttemptsRepositoryPort['abandonAttempt'];
}

function makeService(overrides: Overrides = {}): AbandonPracticeAttemptService {
  const repository: PracticeAttemptsRepositoryPort = {
    findByIdForUser:
      overrides.findByIdForUser ?? (async () => makeAttempt(PracticeAttemptStatus.IN_PROGRESS)),
    abandonAttempt: overrides.abandonAttempt ?? (async () => ({ affected: 1 })),
  };
  return new AbandonPracticeAttemptService({ repository });
}

function assertAbandonErr(err: unknown, code: AbandonPracticeAttemptErrorCode): true {
  assert.ok(err instanceof AbandonPracticeAttemptError);
  assert.equal(err.code, code);
  return true;
}

describe('AbandonPracticeAttemptService.execute', () => {
  it('throws ATTEMPT_NOT_FOUND for a missing/foreign/deleted attempt', async () => {
    const service = makeService({ findByIdForUser: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => assertAbandonErr(err, AbandonPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND),
    );
  });

  it('abandons an in_progress attempt (fresh)', async () => {
    const service = makeService();
    const result = await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(result.attempt.status, PracticeAttemptStatus.ABANDONED);
    assert.equal(result.idempotentReplay, false);
  });

  it('replays idempotently when already abandoned', async () => {
    const service = makeService({
      findByIdForUser: async () => makeAttempt(PracticeAttemptStatus.ABANDONED),
    });
    const result = await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(result.idempotentReplay, true);
  });

  it('throws ATTEMPT_COMPLETED (409) when the attempt is completed', async () => {
    const service = makeService({
      findByIdForUser: async () => makeAttempt(PracticeAttemptStatus.COMPLETED),
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => assertAbandonErr(err, AbandonPracticeAttemptErrorCode.ATTEMPT_COMPLETED),
    );
  });

  it('re-checks status when the conditional update affects 0 rows (lost a race)', async () => {
    let findCalls = 0;
    const service = makeService({
      findByIdForUser: async () => {
        findCalls += 1;
        // First read: in_progress. Second read (after losing the race): completed.
        return findCalls === 1
          ? makeAttempt(PracticeAttemptStatus.IN_PROGRESS)
          : makeAttempt(PracticeAttemptStatus.COMPLETED);
      },
      abandonAttempt: async () => ({ affected: 0 }),
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => assertAbandonErr(err, AbandonPracticeAttemptErrorCode.ATTEMPT_COMPLETED),
    );
    assert.equal(findCalls, 2);
  });

  it('scopes both the read and the update to the given userId', async () => {
    let findUserId: string | undefined;
    let updateUserId: string | undefined;
    const service = makeService({
      findByIdForUser: async (_attemptId, userId) => {
        findUserId = userId;
        return makeAttempt(PracticeAttemptStatus.IN_PROGRESS);
      },
      abandonAttempt: async (_attemptId, userId) => {
        updateUserId = userId;
        return { affected: 1 };
      },
    });
    await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(findUserId, USER_ID);
    assert.equal(updateUserId, USER_ID);
  });
});
