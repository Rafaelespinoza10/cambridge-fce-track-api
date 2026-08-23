import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';
import { MockAttemptSectionStatus } from '@models/enums';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { WritingTask } from '@models/WritingTask';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';
import type {
  FlashcardDraftGeneratorPort,
  WritingCorrectionDraftContext,
} from '../flashcards/flashcard-draft-generator';
import type { WritingCorrectionFlashcardDraftResponse } from '../../interfaces/writing/writing-correction-flashcard-draft.interface';

export enum GenerateMockAttemptCorrectionFlashcardDraftErrorCode {
  INVALID_INPUT = 'invalid_input',
  SECTION_NOT_FOUND = 'section_not_found',
  SECTION_NOT_GRADED = 'section_not_graded',
  CORRECTION_NOT_FOUND = 'correction_not_found',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_RATE_LIMITED = 'ai_rate_limited',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class GenerateMockAttemptCorrectionFlashcardDraftError extends Error {
  constructor(
    message: string,
    readonly code: GenerateMockAttemptCorrectionFlashcardDraftErrorCode,
  ) {
    super(message);
    this.name = 'GenerateMockAttemptCorrectionFlashcardDraftError';
  }
}

export interface MockAttemptsRepositoryPort {
  findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null>;
}

export interface WritingTasksRepositoryPort {
  findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null>;
}

export interface GenerateMockAttemptCorrectionFlashcardDraftServiceDeps {
  generator: FlashcardDraftGeneratorPort;
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
  writingTasks?: (dataSource: DataSource) => WritingTasksRepositoryPort;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (dataSource: DataSource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(dataSource);
const DEFAULT_WRITING_TASKS_FACTORY = (dataSource: DataSource): WritingTasksRepositoryPort =>
  new WritingTasksRepository(dataSource);

function invalidInput(message: string): never {
  throw new GenerateMockAttemptCorrectionFlashcardDraftError(
    message,
    GenerateMockAttemptCorrectionFlashcardDraftErrorCode.INVALID_INPUT,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

const GENERATION_ERROR_CODE_MAP: Record<
  FlashcardDraftGenerationErrorCode,
  GenerateMockAttemptCorrectionFlashcardDraftErrorCode
> = {
  [FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR]:
    GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
  [FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED]:
    GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_RATE_LIMITED,
  [FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT]:
    GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
  [FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE]:
    GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
  [FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE]:
    GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
};

function mapGenerationError(
  error: FlashcardDraftGenerationError,
): GenerateMockAttemptCorrectionFlashcardDraftError {
  return new GenerateMockAttemptCorrectionFlashcardDraftError(
    error.message,
    GENERATION_ERROR_CODE_MAP[error.code],
  );
}

/**
 * Converts one correction from a graded mock-attempt Writing section into an
 * editable flashcard draft — the mock-attempt equivalent of
 * GenerateWritingCorrectionFlashcardDraftService, sourced from
 * MockAttemptSection.grading_feedback instead of a standalone
 * WritingSubmission (a mock attempt's Writing section never creates one —
 * see SubmitMockAttemptSectionService). Never persists anything.
 */
export class GenerateMockAttemptCorrectionFlashcardDraftService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GenerateMockAttemptCorrectionFlashcardDraftServiceDeps,
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    correctionId: string,
  ): Promise<WritingCorrectionFlashcardDraftResponse> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!isNonEmptyString(sectionCode)) invalidInput('sectionCode is required');
    if (!isNonEmptyString(correctionId)) invalidInput('correctionId is required');

    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const section = await mockAttemptsFactory(this.dataSource).findSectionByCodeForUser(
      attemptId,
      sectionCode,
      userId,
    );
    if (section === null) {
      throw new GenerateMockAttemptCorrectionFlashcardDraftError(
        'Mock attempt section not found',
        GenerateMockAttemptCorrectionFlashcardDraftErrorCode.SECTION_NOT_FOUND,
      );
    }
    if (
      section.status !== MockAttemptSectionStatus.COMPLETED ||
      section.grading_feedback === null ||
      section.grading_feedback.kind !== 'writing'
    ) {
      throw new GenerateMockAttemptCorrectionFlashcardDraftError(
        'This Writing section has not been graded yet',
        GenerateMockAttemptCorrectionFlashcardDraftErrorCode.SECTION_NOT_GRADED,
      );
    }

    const correction = section.grading_feedback.corrections.find((c) => c.id === correctionId);
    if (correction === undefined) {
      throw new GenerateMockAttemptCorrectionFlashcardDraftError(
        'Correction not found',
        GenerateMockAttemptCorrectionFlashcardDraftErrorCode.CORRECTION_NOT_FOUND,
      );
    }

    const tasksFactory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
    const task = await tasksFactory(this.dataSource).findByIdForUser(
      section.writing_task_id ?? '',
      userId,
    );
    if (task === null) {
      throw new GenerateMockAttemptCorrectionFlashcardDraftError(
        'Failed to re-read the writing task for this mock attempt section',
        GenerateMockAttemptCorrectionFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const context: WritingCorrectionDraftContext = {
      taskTitle: task.title,
      targetLevel: task.target_level,
      originalExcerpt: correction.originalExcerpt,
      correctedExcerpt: correction.correctedExcerpt,
      explanation: correction.explanation,
      category: correction.category,
    };

    try {
      const draft = await this.deps.generator.generateFromWritingCorrection(context);
      return { draft };
    } catch (err: unknown) {
      if (err instanceof FlashcardDraftGenerationError) throw mapGenerationError(err);
      throw err;
    }
  }
}
