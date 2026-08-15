import { WritingSubmissionStatus } from '../../models/enums';
import type { EnglishLevel } from '../../models/enums';
import type { WritingSubmission } from '../../models/WritingSubmission';
import type { WritingTask } from '../../models/WritingTask';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';
import type {
  FlashcardDraftGeneratorPort,
  WritingCorrectionDraftContext,
} from '../flashcards/flashcard-draft-generator';
import type { WritingCorrectionFlashcardDraftResponse } from '../../interfaces/writing/writing-correction-flashcard-draft.interface';

export enum GenerateWritingCorrectionFlashcardDraftErrorCode {
  INVALID_INPUT = 'invalid_input',
  SUBMISSION_NOT_FOUND = 'submission_not_found',
  SUBMISSION_NOT_GRADED = 'submission_not_graded',
  CORRECTION_NOT_FOUND = 'correction_not_found',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_RATE_LIMITED = 'ai_rate_limited',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class GenerateWritingCorrectionFlashcardDraftError extends Error {
  constructor(
    message: string,
    readonly code: GenerateWritingCorrectionFlashcardDraftErrorCode,
  ) {
    super(message);
    this.name = 'GenerateWritingCorrectionFlashcardDraftError';
  }
}

export interface WritingSubmissionsRepositoryPort {
  findByIdForUser(submissionId: string, userId: string): Promise<WritingSubmission | null>;
}

export interface WritingTasksRepositoryPort {
  findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null>;
}

export interface GenerateWritingCorrectionFlashcardDraftServiceDeps {
  submissions: WritingSubmissionsRepositoryPort;
  tasks: WritingTasksRepositoryPort;
  generator: FlashcardDraftGeneratorPort;
}

function invalidInput(message: string): never {
  throw new GenerateWritingCorrectionFlashcardDraftError(
    message,
    GenerateWritingCorrectionFlashcardDraftErrorCode.INVALID_INPUT,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

const GENERATION_ERROR_CODE_MAP: Record<
  FlashcardDraftGenerationErrorCode,
  GenerateWritingCorrectionFlashcardDraftErrorCode
> = {
  [FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR]:
    GenerateWritingCorrectionFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
  [FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED]:
    GenerateWritingCorrectionFlashcardDraftErrorCode.AI_RATE_LIMITED,
  [FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT]:
    GenerateWritingCorrectionFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
  [FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE]:
    GenerateWritingCorrectionFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
  [FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE]:
    GenerateWritingCorrectionFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
};

function mapGenerationError(
  error: FlashcardDraftGenerationError,
): GenerateWritingCorrectionFlashcardDraftError {
  return new GenerateWritingCorrectionFlashcardDraftError(
    error.message,
    GENERATION_ERROR_CODE_MAP[error.code],
  );
}

/**
 * Converts one correction from a graded WritingSubmission into an editable
 * flashcard draft. Never persists anything — no flashcard, no deck
 * selection, no change to the submission. The frontend saves the returned
 * draft (or not) through the existing flashcard CRUD. Mirrors
 * GeneratePracticeErrorFlashcardDraftService.
 */
export class GenerateWritingCorrectionFlashcardDraftService {
  constructor(private readonly deps: GenerateWritingCorrectionFlashcardDraftServiceDeps) {}

  async execute(
    userId: string,
    submissionId: string,
    correctionId: string,
  ): Promise<WritingCorrectionFlashcardDraftResponse> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(submissionId)) invalidInput('submissionId is required');
    if (!isNonEmptyString(correctionId)) invalidInput('correctionId is required');

    const submission = await this.deps.submissions.findByIdForUser(submissionId, userId);
    if (submission === null) {
      throw new GenerateWritingCorrectionFlashcardDraftError(
        'Writing submission not found',
        GenerateWritingCorrectionFlashcardDraftErrorCode.SUBMISSION_NOT_FOUND,
      );
    }

    if (submission.status !== WritingSubmissionStatus.GRADED || submission.feedback === null) {
      throw new GenerateWritingCorrectionFlashcardDraftError(
        'This writing submission has not been graded yet',
        GenerateWritingCorrectionFlashcardDraftErrorCode.SUBMISSION_NOT_GRADED,
      );
    }

    const correction = submission.feedback.corrections.find((c) => c.id === correctionId);
    if (correction === undefined) {
      throw new GenerateWritingCorrectionFlashcardDraftError(
        'Correction not found',
        GenerateWritingCorrectionFlashcardDraftErrorCode.CORRECTION_NOT_FOUND,
      );
    }

    const task = await this.deps.tasks.findByIdForUser(submission.task_id, userId);
    if (task === null) {
      // Unreachable given the composite FK (submission.task_id, user_id) ->
      // writing_tasks(id, user_id), but fail loudly instead of building
      // context from nothing.
      throw new GenerateWritingCorrectionFlashcardDraftError(
        'Failed to re-read the task for a graded writing submission',
        GenerateWritingCorrectionFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const context: WritingCorrectionDraftContext = {
      taskTitle: task.title,
      targetLevel: task.target_level as EnglishLevel | null,
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
