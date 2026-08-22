import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import type { MockAttemptSafeDto } from '../../interfaces/mocks/mock-attempt.interface';

export interface MockAttemptsRepositoryPort {
  findActiveByUser(userId: string): Promise<MockAttempt | null>;
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
}

export interface GetActiveMockAttemptServiceDeps {
  repository: MockAttemptsRepositoryPort;
}

/** No error class — always succeeds with either `{ attempt: null }` or a full view. */
export class GetActiveMockAttemptService {
  constructor(private readonly deps: GetActiveMockAttemptServiceDeps) {}

  async execute(userId: string): Promise<{ attempt: MockAttemptSafeDto | null }> {
    const active = await this.deps.repository.findActiveByUser(userId);
    if (active === null) return { attempt: null };

    const sections = await this.deps.repository.findSectionsByAttempt(active.id);
    return { attempt: toMockAttemptSafeDto(active, sections) };
  }
}
