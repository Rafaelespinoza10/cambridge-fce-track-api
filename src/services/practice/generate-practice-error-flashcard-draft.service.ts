import { PracticeAttemptStatus } from '../../models/enums';
import type { EnglishLevel } from '../../models/enums';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import { formatAcceptedAnswers, formatUserAnswer } from '@lib/practice/practice-attempt-grading';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';
import type {
  FlashcardDraftGeneratorPort,
  PracticeErrorDraftContext,
} from '../flashcards/flashcard-draft-generator';
import type { PracticeErrorFlashcardDraftResponse } from '../../interfaces/practice/practice-error-flashcard-draft.interface';

export enum GeneratePracticeErrorFlashcardDraftErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  PRACTICE_ITEM_NOT_FOUND = 'practice_item_not_found',
  ATTEMPT_NOT_COMPLETED = 'attempt_not_completed',
  PRACTICE_ITEM_NOT_INCORRECT = 'practice_item_not_incorrect',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_RATE_LIMITED = 'ai_rate_limited',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class GeneratePracticeErrorFlashcardDraftError extends Error {
  constructor(
    message: string,
    readonly code: GeneratePracticeErrorFlashcardDraftErrorCode,
  ) {
    super(message);
    this.name = 'GeneratePracticeErrorFlashcardDraftError';
  }
}

export interface PracticeAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<PracticeAttempt | null>;
}

export interface PracticeExercisesRepositoryPort {
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ exercise: PracticeExercise; items: PracticeItem[] } | null>;
}

export interface PracticeAnswersRepositoryPort {
  findByAttemptAndItemForUser(
    attemptId: string,
    itemId: string,
    userId: string,
  ): Promise<PracticeAnswer | null>;
}

export interface GeneratePracticeErrorFlashcardDraftServiceDeps {
  attempts: PracticeAttemptsRepositoryPort;
  exercises: PracticeExercisesRepositoryPort;
  answers: PracticeAnswersRepositoryPort;
  generator: FlashcardDraftGeneratorPort;
}

function invalidInput(message: string): never {
  throw new GeneratePracticeErrorFlashcardDraftError(
    message,
    GeneratePracticeErrorFlashcardDraftErrorCode.INVALID_INPUT,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

const GENERATION_ERROR_CODE_MAP: Record<
  FlashcardDraftGenerationErrorCode,
  GeneratePracticeErrorFlashcardDraftErrorCode
> = {
  [FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR]:
    GeneratePracticeErrorFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
  [FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED]:
    GeneratePracticeErrorFlashcardDraftErrorCode.AI_RATE_LIMITED,
  [FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT]:
    GeneratePracticeErrorFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
  [FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE]:
    GeneratePracticeErrorFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
  [FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE]:
    GeneratePracticeErrorFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
};

function mapGenerationError(
  error: FlashcardDraftGenerationError,
): GeneratePracticeErrorFlashcardDraftError {
  return new GeneratePracticeErrorFlashcardDraftError(
    error.message,
    GENERATION_ERROR_CODE_MAP[error.code],
  );
}

/** Formats options as readable "id) label" lines for single_choice items — null otherwise. */
function formatOptionsForContext(item: PracticeItem): string | null {
  if (item.options === null || item.options.length === 0) return null;
  return item.options.map((option) => `${option.id}) ${option.label}`).join('\n');
}

function buildContext(
  exercise: PracticeExercise,
  item: PracticeItem,
  answer: PracticeAnswer,
): PracticeErrorDraftContext {
  return {
    examCode: exercise.exam_code,
    paperCode: exercise.paper_code,
    partCode: exercise.part_code,
    taskType: item.task_type,
    prompt: item.prompt,
    stimulus: exercise.stimulus,
    options: formatOptionsForContext(item),
    userAnswer: formatUserAnswer(item, answer.answer_payload),
    correctAnswer: formatAcceptedAnswers(item).join(' / '),
    explanation: item.explanation,
    skillTags: item.skill_tags,
    targetLevel: exercise.target_level as EnglishLevel | null,
  };
}

/**
 * Converts one incorrect/unanswered PracticeAnswer into an editable
 * flashcard draft. Never persists anything — no flashcard, no deck
 * selection, no change to the attempt/answer/statistics. The frontend saves
 * the returned draft (or not) through the existing flashcard CRUD.
 */
export class GeneratePracticeErrorFlashcardDraftService {
  constructor(private readonly deps: GeneratePracticeErrorFlashcardDraftServiceDeps) {}

  async execute(
    userId: string,
    attemptId: string,
    itemId: string,
  ): Promise<PracticeErrorFlashcardDraftResponse> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!isNonEmptyString(itemId)) invalidInput('itemId is required');

    const attempt = await this.deps.attempts.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new GeneratePracticeErrorFlashcardDraftError(
        'Practice attempt not found',
        GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_FOUND,
      );
    }

    if (attempt.status !== PracticeAttemptStatus.COMPLETED) {
      throw new GeneratePracticeErrorFlashcardDraftError(
        'This practice attempt is not completed yet',
        GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_COMPLETED,
      );
    }

    const withKeys = await this.deps.exercises.findExerciseWithAnswerKeysForEvaluation(
      attempt.exercise_id,
      userId,
    );
    if (withKeys === null) {
      // Unreachable given the composite FK (attempt.exercise_id, user_id) ->
      // practice_exercises(id, user_id), but fail loudly instead of
      // silently building context from nothing.
      throw new GeneratePracticeErrorFlashcardDraftError(
        'Failed to re-read the exercise for a completed practice attempt',
        GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const item = withKeys.items.find((candidate) => candidate.id === itemId);
    if (item === undefined) {
      throw new GeneratePracticeErrorFlashcardDraftError(
        'Practice item not found',
        GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_FOUND,
      );
    }

    const answer = await this.deps.answers.findByAttemptAndItemForUser(attemptId, itemId, userId);
    if (answer === null) {
      // PR 3 guarantees exactly one persisted PracticeAnswer per item on a
      // completed attempt. We already know the attempt is completed and the
      // item belongs to its exercise, so a missing answer here is never a
      // legitimate "not found" from the client's perspective — it's internal
      // data corruption. Fail loudly as a 500, not a 404.
      throw new GeneratePracticeErrorFlashcardDraftError(
        'No persisted answer was found for this item on a completed attempt',
        GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    if (answer.is_correct) {
      throw new GeneratePracticeErrorFlashcardDraftError(
        'This item was answered correctly — nothing to convert into a flashcard',
        GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_INCORRECT,
      );
    }

    const context = buildContext(withKeys.exercise, item, answer);

    try {
      const draft = await this.deps.generator.generateFromPracticeError(context);
      return { draft };
    } catch (err: unknown) {
      if (err instanceof FlashcardDraftGenerationError) throw mapGenerationError(err);
      throw err;
    }
  }
}
