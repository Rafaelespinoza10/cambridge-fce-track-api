import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import {
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { MockAttemptSectionAnswers } from '@models/mock-attempt-json-types';
import { isMockAttemptObjectiveAnswer } from '@lib/mocks/mock-attempt-jsonb-validators';
import { findMockAttemptSectionCatalogEntry } from '@lib/mocks/mock-attempt-catalog';
import type {
  SaveMockAttemptSectionDraftRequest,
  SaveMockAttemptSectionDraftResultDto,
} from '../../interfaces/mocks/mock-attempt.interface';

export enum SaveMockAttemptSectionDraftErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_NOT_ACTIVE = 'attempt_not_active',
  SECTION_NOT_FOUND = 'section_not_found',
  SECTION_NOT_STARTED = 'section_not_started',
  SECTION_ALREADY_COMPLETED = 'section_already_completed',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class SaveMockAttemptSectionDraftError extends Error {
  constructor(
    message: string,
    readonly code: SaveMockAttemptSectionDraftErrorCode,
  ) {
    super(message);
    this.name = 'SaveMockAttemptSectionDraftError';
  }
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null>;
  saveSectionDraftAnswers(sectionId: string, answers: MockAttemptSectionAnswers): Promise<void>;
}

export interface SaveMockAttemptSectionDraftServiceDeps {
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (dataSource: DataSource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(dataSource);

// Generous but bounded — a draft is never graded, so these limits only
// guard against an abusive payload, not against an incomplete one (a draft
// answering 3 of 8 items, or a half-written essay, is the whole point).
const DRAFT_CONTENT_MAX_LENGTH = 6000;
const DRAFT_MAX_ANSWERS = 50;

function invalidInput(message: string): never {
  throw new SaveMockAttemptSectionDraftError(
    message,
    SaveMockAttemptSectionDraftErrorCode.INVALID_INPUT,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Persists whatever the student has typed so far in one still-open section
 * — never graded, never scored, never marks the section completed. Exists
 * so a page refresh (or a crash) mid-section doesn't lose in-progress
 * answers the way it did before: StartMockAttemptSectionService only ever
 * returns the last value saved here (see toDraftAnswersDto) or, before the
 * first save, null. A completed section can no longer be drafted over —
 * SubmitMockAttemptSectionService already owns that state transition and
 * its grading result is final.
 */
export class SaveMockAttemptSectionDraftService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SaveMockAttemptSectionDraftServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    request: SaveMockAttemptSectionDraftRequest,
  ): Promise<SaveMockAttemptSectionDraftResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!isNonEmptyString(sectionCode)) invalidInput('sectionCode is required');

    const factory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const repo = factory(this.dataSource);

    const attempt = await repo.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new SaveMockAttemptSectionDraftError(
        'Mock attempt not found',
        SaveMockAttemptSectionDraftErrorCode.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.status !== MockAttemptStatus.IN_PROGRESS) {
      throw new SaveMockAttemptSectionDraftError(
        'This mock attempt is not in progress',
        SaveMockAttemptSectionDraftErrorCode.ATTEMPT_NOT_ACTIVE,
      );
    }

    const section = await repo.findSectionByCodeForUser(attemptId, sectionCode, userId);
    if (section === null) {
      throw new SaveMockAttemptSectionDraftError(
        'Mock attempt section not found',
        SaveMockAttemptSectionDraftErrorCode.SECTION_NOT_FOUND,
      );
    }
    if (section.status === MockAttemptSectionStatus.PENDING) {
      throw new SaveMockAttemptSectionDraftError(
        'This section has not been started yet',
        SaveMockAttemptSectionDraftErrorCode.SECTION_NOT_STARTED,
      );
    }
    if (section.status === MockAttemptSectionStatus.COMPLETED) {
      throw new SaveMockAttemptSectionDraftError(
        'This section is already completed and its result is final',
        SaveMockAttemptSectionDraftErrorCode.SECTION_ALREADY_COMPLETED,
      );
    }

    const catalogEntry = findMockAttemptSectionCatalogEntry(sectionCode);
    if (catalogEntry === undefined) {
      throw new SaveMockAttemptSectionDraftError(
        'This section is not registered in the mock attempt catalog',
        SaveMockAttemptSectionDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const answers = this.buildDraftAnswers(request, catalogEntry.contentType);
    await repo.saveSectionDraftAnswers(section.id, answers);

    return { saved: true };
  }

  private buildDraftAnswers(
    request: SaveMockAttemptSectionDraftRequest,
    contentType: MockAttemptSectionContentType,
  ): MockAttemptSectionAnswers {
    if (contentType === MockAttemptSectionContentType.WRITING_TASK) {
      if (!('content' in request) || typeof request.content !== 'string') {
        invalidInput('content is required for a writing section draft');
      }
      if (request.content.length > DRAFT_CONTENT_MAX_LENGTH) {
        invalidInput(`content exceeds ${DRAFT_CONTENT_MAX_LENGTH} characters`);
      }
      return { kind: 'writing', content: request.content };
    }

    if (!('answers' in request) || !Array.isArray(request.answers)) {
      invalidInput('answers is required for this section draft');
    }
    if (request.answers.length > DRAFT_MAX_ANSWERS) {
      invalidInput(`answers must contain at most ${DRAFT_MAX_ANSWERS} entries`);
    }
    for (const answer of request.answers) {
      if (!isMockAttemptObjectiveAnswer(answer)) invalidInput('answers contains an invalid entry');
    }

    return {
      kind: 'objective',
      answers: request.answers.map((a) => ({
        itemId: a.itemId,
        answer: a.answer,
        responseTimeMs: a.responseTimeMs ?? null,
      })),
    };
  }
}
