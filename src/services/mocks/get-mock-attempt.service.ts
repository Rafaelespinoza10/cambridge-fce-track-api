import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import type { MockAttemptSafeDto } from '../../interfaces/mocks/mock-attempt.interface';

export enum GetMockAttemptErrorCode {
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
}

export class GetMockAttemptError extends Error {
  constructor(
    message: string,
    readonly code: GetMockAttemptErrorCode,
  ) {
    super(message);
    this.name = 'GetMockAttemptError';
  }
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
}

export interface GetMockAttemptServiceDeps {
  repository: MockAttemptsRepositoryPort;
}

/**
 * Fetches one mock attempt by id, with its sections' safe (no-content)
 * status. To see the finished MockTest's actual scores once
 * result_mock_test_id is set, the client calls the existing GET /mocks/{id}
 * — this service never duplicates that response.
 */
export class GetMockAttemptService {
  constructor(private readonly deps: GetMockAttemptServiceDeps) {}

  async execute(userId: string, attemptId: string): Promise<MockAttemptSafeDto> {
    const attempt = await this.deps.repository.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new GetMockAttemptError('Mock attempt not found', GetMockAttemptErrorCode.ATTEMPT_NOT_FOUND);
    }
    const sections = await this.deps.repository.findSectionsByAttempt(attemptId);
    return toMockAttemptSafeDto(attempt, sections);
  }
}
