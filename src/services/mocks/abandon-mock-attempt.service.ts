import { MockAttemptStatus } from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import type { MockAttemptSafeDto } from '../../interfaces/mocks/mock-attempt.interface';

export enum AbandonMockAttemptErrorCode {
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_COMPLETED = 'attempt_completed',
}

export class AbandonMockAttemptError extends Error {
  constructor(
    message: string,
    readonly code: AbandonMockAttemptErrorCode,
  ) {
    super(message);
    this.name = 'AbandonMockAttemptError';
  }
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
  abandonAttempt(attemptId: string): Promise<void>;
}

export interface AbandonMockAttemptServiceDeps {
  repository: MockAttemptsRepositoryPort;
}

/** Same idempotent shape as AbandonPracticeAttemptService: in_progress -> abandoned (fresh); abandoned replays; completed is rejected. */
export class AbandonMockAttemptService {
  constructor(private readonly deps: AbandonMockAttemptServiceDeps) {}

  async execute(
    userId: string,
    attemptId: string,
  ): Promise<{ attempt: MockAttemptSafeDto; idempotentReplay: boolean }> {
    const attempt = await this.deps.repository.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new AbandonMockAttemptError(
        'Mock attempt not found',
        AbandonMockAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }

    const sections = await this.deps.repository.findSectionsByAttempt(attemptId);

    if (attempt.status === MockAttemptStatus.ABANDONED) {
      return { attempt: toMockAttemptSafeDto(attempt, sections), idempotentReplay: true };
    }
    if (attempt.status === MockAttemptStatus.COMPLETED) {
      throw new AbandonMockAttemptError(
        'This mock attempt is already completed and cannot be abandoned',
        AbandonMockAttemptErrorCode.ATTEMPT_COMPLETED,
      );
    }

    await this.deps.repository.abandonAttempt(attemptId);
    const abandoned = { ...attempt, status: MockAttemptStatus.ABANDONED };
    return { attempt: toMockAttemptSafeDto(abandoned, sections), idempotentReplay: false };
  }
}
