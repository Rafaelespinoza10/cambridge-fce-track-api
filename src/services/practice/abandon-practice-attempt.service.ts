import { PracticeAttemptStatus } from '../../models/enums';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeAttemptAbandonResultDto } from '../../interfaces/practice/practice-attempt.interface';
import { toPracticeAttemptSafeDto } from '@lib/practice/practice-attempt-dto';

export enum AbandonPracticeAttemptErrorCode {
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_COMPLETED = 'attempt_completed',
}

export class AbandonPracticeAttemptError extends Error {
  constructor(
    message: string,
    readonly code: AbandonPracticeAttemptErrorCode,
  ) {
    super(message);
    this.name = 'AbandonPracticeAttemptError';
  }
}

export interface PracticeAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<PracticeAttempt | null>;
  abandonAttempt(attemptId: string, userId: string): Promise<{ affected?: number | null }>;
}

export interface AbandonPracticeAttemptServiceDeps {
  repository: PracticeAttemptsRepositoryPort;
}

/**
 * No transaction/lock needed — `abandonAttempt` is a single conditional
 * `UPDATE ... WHERE status = 'in_progress'`, already atomic on its own.
 * `in_progress -> abandoned` (fresh); `abandoned` replays idempotently;
 * `completed` is rejected (409) — you can't abandon a graded attempt.
 */
export class AbandonPracticeAttemptService {
  constructor(private readonly deps: AbandonPracticeAttemptServiceDeps) {}

  async execute(userId: string, attemptId: string): Promise<PracticeAttemptAbandonResultDto> {
    const attempt = await this.deps.repository.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new AbandonPracticeAttemptError(
        'Practice attempt not found',
        AbandonPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }
    return this.resolve(attempt, userId, attemptId);
  }

  private async resolve(
    attempt: PracticeAttempt,
    userId: string,
    attemptId: string,
  ): Promise<PracticeAttemptAbandonResultDto> {
    if (attempt.status === PracticeAttemptStatus.ABANDONED) {
      return { attempt: toPracticeAttemptSafeDto(attempt), idempotentReplay: true };
    }
    if (attempt.status === PracticeAttemptStatus.COMPLETED) {
      throw new AbandonPracticeAttemptError(
        'This practice attempt is already completed and cannot be abandoned',
        AbandonPracticeAttemptErrorCode.ATTEMPT_COMPLETED,
      );
    }

    // status === IN_PROGRESS
    const updateResult = await this.deps.repository.abandonAttempt(attemptId, userId);
    if (updateResult.affected !== 1) {
      // Lost a race against a concurrent abandon/complete — re-fetch and
      // branch again instead of assuming this call actually won.
      const refetched = await this.deps.repository.findByIdForUser(attemptId, userId);
      if (refetched === null) {
        throw new AbandonPracticeAttemptError(
          'Practice attempt not found',
          AbandonPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND,
        );
      }
      return this.resolve(refetched, userId, attemptId);
    }

    const abandoned = { ...attempt, status: PracticeAttemptStatus.ABANDONED };
    return { attempt: toPracticeAttemptSafeDto(abandoned), idempotentReplay: false };
  }
}
