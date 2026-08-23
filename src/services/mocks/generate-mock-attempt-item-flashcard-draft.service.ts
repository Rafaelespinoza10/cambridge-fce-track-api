import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import type { ListeningItem } from '@models/ListeningItem';
import { MockAttemptSectionStatus, MockAttemptSectionContentType } from '@models/enums';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeExercise } from '@models/PracticeExercise';
import type { PracticeItem } from '@models/PracticeItem';
import {
  gradeItem,
  formatAcceptedAnswers,
  formatUserAnswer,
} from '@lib/practice/practice-attempt-grading';
import {
  findMockAttemptSectionCatalogEntry,
  type MockAttemptSectionCatalogEntry,
} from '@lib/mocks/mock-attempt-catalog';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';
import type {
  FlashcardDraftGeneratorPort,
  PracticeErrorDraftContext,
} from '../flashcards/flashcard-draft-generator';
import type { PracticeErrorFlashcardDraftResponse } from '../../interfaces/practice/practice-error-flashcard-draft.interface';

export enum GenerateMockAttemptItemFlashcardDraftErrorCode {
  INVALID_INPUT = 'invalid_input',
  SECTION_NOT_FOUND = 'section_not_found',
  SECTION_NOT_COMPLETED = 'section_not_completed',
  ITEM_NOT_FOUND = 'item_not_found',
  ITEM_NOT_INCORRECT = 'item_not_incorrect',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_RATE_LIMITED = 'ai_rate_limited',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class GenerateMockAttemptItemFlashcardDraftError extends Error {
  constructor(
    message: string,
    readonly code: GenerateMockAttemptItemFlashcardDraftErrorCode,
  ) {
    super(message);
    this.name = 'GenerateMockAttemptItemFlashcardDraftError';
  }
}

export interface MockAttemptsRepositoryPort {
  findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null>;
}

export interface PracticeExercisesRepositoryPort {
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ exercise: PracticeExercise; items: PracticeItem[] } | null>;
}

export interface ListeningSourcesRepositoryPort {
  findItemsWithAnswerKeysBySourceId(sourceId: string): Promise<ListeningItem[]>;
}

export interface GenerateMockAttemptItemFlashcardDraftServiceDeps {
  generator: FlashcardDraftGeneratorPort;
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
  practiceExercises?: (dataSource: DataSource) => PracticeExercisesRepositoryPort;
  listeningSources?: (dataSource: DataSource) => ListeningSourcesRepositoryPort;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (dataSource: DataSource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(dataSource);
const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  dataSource: DataSource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(dataSource);
const DEFAULT_LISTENING_SOURCES_FACTORY = (
  dataSource: DataSource,
): ListeningSourcesRepositoryPort => new ListeningSourcesRepository(dataSource);

function invalidInput(message: string): never {
  throw new GenerateMockAttemptItemFlashcardDraftError(
    message,
    GenerateMockAttemptItemFlashcardDraftErrorCode.INVALID_INPUT,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

const GENERATION_ERROR_CODE_MAP: Record<
  FlashcardDraftGenerationErrorCode,
  GenerateMockAttemptItemFlashcardDraftErrorCode
> = {
  [FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR]:
    GenerateMockAttemptItemFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR,
  [FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED]:
    GenerateMockAttemptItemFlashcardDraftErrorCode.AI_RATE_LIMITED,
  [FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT]:
    GenerateMockAttemptItemFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT,
  [FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE]:
    GenerateMockAttemptItemFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE,
  [FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE]:
    GenerateMockAttemptItemFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
};

function mapGenerationError(
  error: FlashcardDraftGenerationError,
): GenerateMockAttemptItemFlashcardDraftError {
  return new GenerateMockAttemptItemFlashcardDraftError(
    error.message,
    GENERATION_ERROR_CODE_MAP[error.code],
  );
}

function formatOptionsForContext(item: { options: PracticeItem['options'] }): string | null {
  if (item.options === null || item.options.length === 0) return null;
  return item.options.map((option) => `${option.id}) ${option.label}`).join('\n');
}

/**
 * Converts one incorrect objective item (Use of English/Reading/Listening)
 * from a completed mock-attempt section into an editable flashcard draft —
 * the mock-attempt equivalent of GeneratePracticeErrorFlashcardDraftService.
 * Unlike a standalone PracticeAttempt, a mock attempt never persists a
 * per-item PracticeAnswer row (see SubmitMockAttemptSectionService — only
 * the aggregate feedback summary is stored), so correctness is
 * recomputed here with the exact same pure gradeItem() used at grading
 * time rather than read off a stored flag. Never persists anything — no
 * flashcard, no deck selection, no change to the section.
 */
export class GenerateMockAttemptItemFlashcardDraftService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GenerateMockAttemptItemFlashcardDraftServiceDeps,
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    itemId: string,
  ): Promise<PracticeErrorFlashcardDraftResponse> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!isNonEmptyString(sectionCode)) invalidInput('sectionCode is required');
    if (!isNonEmptyString(itemId)) invalidInput('itemId is required');

    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const section = await mockAttemptsFactory(this.dataSource).findSectionByCodeForUser(
      attemptId,
      sectionCode,
      userId,
    );
    if (section === null) {
      throw new GenerateMockAttemptItemFlashcardDraftError(
        'Mock attempt section not found',
        GenerateMockAttemptItemFlashcardDraftErrorCode.SECTION_NOT_FOUND,
      );
    }
    if (section.status !== MockAttemptSectionStatus.COMPLETED || Array.isArray(section.answers)) {
      throw new GenerateMockAttemptItemFlashcardDraftError(
        'This section has not been graded yet',
        GenerateMockAttemptItemFlashcardDraftErrorCode.SECTION_NOT_COMPLETED,
      );
    }
    if (section.answers.kind !== 'objective') {
      invalidInput('This section is not an objective (Use of English/Reading/Listening) section');
    }

    const catalogEntry = findMockAttemptSectionCatalogEntry(sectionCode);
    if (catalogEntry === undefined) {
      throw new GenerateMockAttemptItemFlashcardDraftError(
        'This section is not registered in the mock attempt catalog',
        GenerateMockAttemptItemFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const context = await this.buildContext(userId, section, catalogEntry, itemId);

    try {
      const draft = await this.deps.generator.generateFromPracticeError(context);
      return { draft };
    } catch (err: unknown) {
      if (err instanceof FlashcardDraftGenerationError) throw mapGenerationError(err);
      throw err;
    }
  }

  private async buildContext(
    userId: string,
    section: MockAttemptSection,
    catalogEntry: MockAttemptSectionCatalogEntry,
    itemId: string,
  ): Promise<PracticeErrorDraftContext> {
    if (section.answers === undefined || Array.isArray(section.answers)) {
      // Unreachable — already checked by the caller — but keeps this
      // function's own type narrow without an unsafe assertion.
      throw new GenerateMockAttemptItemFlashcardDraftError(
        'Mock attempt section has no persisted answers',
        GenerateMockAttemptItemFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    const answerEntry =
      section.answers.kind === 'objective'
        ? section.answers.answers.find((a) => a.itemId === itemId)
        : undefined;
    const answerPayload = answerEntry?.answer ?? { kind: 'unanswered' as const };

    if (catalogEntry.contentType === MockAttemptSectionContentType.PRACTICE_EXERCISE) {
      const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
      const withKeys = await factory(this.dataSource).findExerciseWithAnswerKeysForEvaluation(
        section.practice_exercise_id ?? '',
        userId,
      );
      if (withKeys === null) {
        throw new GenerateMockAttemptItemFlashcardDraftError(
          'Failed to re-read the exercise for this mock attempt section',
          GenerateMockAttemptItemFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      const item = withKeys.items.find((candidate) => candidate.id === itemId);
      if (item === undefined) {
        throw new GenerateMockAttemptItemFlashcardDraftError(
          'Item not found',
          GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_FOUND,
        );
      }
      const graded = gradeItem(item.answer_key, answerPayload);
      if (graded.isCorrect) {
        throw new GenerateMockAttemptItemFlashcardDraftError(
          'This item was answered correctly — nothing to convert into a flashcard',
          GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_INCORRECT,
        );
      }
      return {
        examCode: catalogEntry.examCode,
        paperCode: catalogEntry.paperCode,
        partCode: catalogEntry.partCode,
        taskType: item.task_type,
        prompt: item.prompt,
        stimulus: withKeys.exercise.stimulus,
        options: formatOptionsForContext(item),
        userAnswer: formatUserAnswer(item, answerPayload),
        correctAnswer: formatAcceptedAnswers(item).join(' / '),
        explanation: item.explanation,
        skillTags: item.skill_tags,
        targetLevel: withKeys.exercise.target_level,
      };
    }

    const listeningFactory = this.deps.listeningSources ?? DEFAULT_LISTENING_SOURCES_FACTORY;
    const items = await listeningFactory(this.dataSource).findItemsWithAnswerKeysBySourceId(
      section.listening_source_id ?? '',
    );
    const item = items.find((candidate) => candidate.id === itemId);
    if (item === undefined) {
      throw new GenerateMockAttemptItemFlashcardDraftError(
        'Item not found',
        GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_FOUND,
      );
    }
    const graded = gradeItem(item.answer_key, answerPayload);
    if (graded.isCorrect) {
      throw new GenerateMockAttemptItemFlashcardDraftError(
        'This item was answered correctly — nothing to convert into a flashcard',
        GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_INCORRECT,
      );
    }
    return {
      examCode: catalogEntry.examCode,
      paperCode: catalogEntry.paperCode,
      partCode: catalogEntry.partCode,
      taskType: 'listening',
      prompt: item.prompt,
      stimulus: null,
      options: formatOptionsForContext(item),
      userAnswer: formatUserAnswer(item, answerPayload),
      correctAnswer: formatAcceptedAnswers(item).join(' / '),
      explanation: item.explanation,
      skillTags: item.skill_tags,
      targetLevel: null,
    };
  }
}
