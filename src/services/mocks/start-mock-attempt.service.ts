import type { DataSource, EntityManager } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import type { CreateAttemptSectionSeed } from '@repositories/mocks/mock-attempts.repository';
import { ExamType } from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import { MOCK_ATTEMPT_SECTION_CATALOG } from '@lib/mocks/mock-attempt-catalog';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import type { MockAttemptStartResultDto } from '../../interfaces/mocks/mock-attempt.interface';

export enum StartMockAttemptErrorCode {
  INVALID_INPUT = 'invalid_input',
  RACE_UNRESOLVED = 'race_unresolved',
}

export class StartMockAttemptError extends Error {
  constructor(
    message: string,
    readonly code: StartMockAttemptErrorCode,
  ) {
    super(message);
    this.name = 'StartMockAttemptError';
  }
}

type RepositorySource = DataSource | EntityManager;

export interface MockAttemptsRepositoryPort {
  findActiveByUser(userId: string): Promise<MockAttempt | null>;
  createAttemptWithSections(data: {
    userId: string;
    examType: ExamType;
    startedAt: Date;
    sections: CreateAttemptSectionSeed[];
  }): Promise<MockAttempt>;
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
}

export interface StartMockAttemptServiceDeps {
  mockAttempts?: (source: RepositorySource) => MockAttemptsRepositoryPort;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (source: RepositorySource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(source);

const MAX_RACE_RETRIES = 1;
const ACTIVE_ATTEMPT_CONSTRAINT_NAME = 'uq_mock_attempts_one_active_per_user';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

// Same detection pattern as StartPracticeAttemptService/StartWritingSubmissionService.
function isActiveAttemptConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === ACTIVE_ATTEMPT_CONSTRAINT_NAME;
}

function invalidInput(message: string): never {
  throw new StartMockAttemptError(message, StartMockAttemptErrorCode.INVALID_INPUT);
}

/**
 * Starts a new full-mock attempt or resumes the user's existing in-progress
 * one — a mock attempt has no separate "which exercise" concept to compare
 * against the way Practice does, so any active attempt is always resumable.
 * Pre-creates one 'pending' MockAttemptSection per MOCK_ATTEMPT_SECTION_CATALOG
 * entry (13 for B2_FIRST); section content is generated lazily, on first
 * entry into each section (see StartMockAttemptSectionService) — never all
 * 13 up front, to stay well under the httpApi ~29s hard timeout.
 */
export class StartMockAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: StartMockAttemptServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    examType: ExamType,
    startedAt: Date,
  ): Promise<MockAttemptStartResultDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
      invalidInput('startedAt must be a valid Date');
    }
    if (examType !== ExamType.B2_FIRST) {
      invalidInput('Only B2_FIRST full timed mocks are supported today');
    }

    return this.executeWithRetry(userId, examType, startedAt, 0);
  }

  private async executeWithRetry(
    userId: string,
    examType: ExamType,
    startedAt: Date,
    attempt: number,
  ): Promise<MockAttemptStartResultDto> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.runInTransaction(manager, userId, examType, startedAt),
      );
    } catch (error) {
      if (isActiveAttemptConstraintViolation(error)) {
        if (attempt < MAX_RACE_RETRIES) {
          return this.executeWithRetry(userId, examType, startedAt, attempt + 1);
        }
        throw new StartMockAttemptError(
          'Could not resolve the active mock attempt after a race retry',
          StartMockAttemptErrorCode.RACE_UNRESOLVED,
        );
      }
      throw error;
    }
  }

  private async runInTransaction(
    manager: EntityManager,
    userId: string,
    examType: ExamType,
    startedAt: Date,
  ): Promise<MockAttemptStartResultDto> {
    const factory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const repo = factory(manager);

    const active = await repo.findActiveByUser(userId);
    if (active !== null) {
      return this.buildResult(manager, active, true);
    }

    const sections: CreateAttemptSectionSeed[] = MOCK_ATTEMPT_SECTION_CATALOG.map((entry) => ({
      sectionCode: entry.sectionCode,
      contentType: entry.contentType,
      timeLimitSeconds: entry.defaultDurationMinutes * 60,
    }));
    const created = await repo.createAttemptWithSections({
      userId,
      examType,
      startedAt,
      sections,
    });
    return this.buildResult(manager, created, false);
  }

  private async buildResult(
    source: RepositorySource,
    attempt: MockAttempt,
    resumed: boolean,
  ): Promise<MockAttemptStartResultDto> {
    const factory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const sections = await factory(source).findSectionsByAttempt(attempt.id);
    return { attempt: toMockAttemptSafeDto(attempt, sections), resumed };
  }
}
