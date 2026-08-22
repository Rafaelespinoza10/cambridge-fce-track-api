import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import {
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeItem } from '@models/PracticeItem';
import type { WritingTask } from '@models/WritingTask';
import type { PracticeItemAnswerKey } from '@models/practice-json-types';
import type {
  MockAttemptSectionAnswers,
  MockAttemptSectionGradingFeedback,
} from '@models/mock-attempt-json-types';
import {
  gradeItem,
  computeFeedbackSummary,
  roundToTwoDecimals,
} from '@lib/practice/practice-attempt-grading';
import { isMockAttemptObjectiveAnswer } from '@lib/mocks/mock-attempt-jsonb-validators';
import { gradeWritingSubmission, WritingGradingError } from '@lib/writing/writing-grading';
import type { WritingGradingLLMPort } from '@lib/writing/writing-grading';
import { findMockAttemptSectionCatalogEntry } from '@lib/mocks/mock-attempt-catalog';
import { toMockAttemptSectionSafeDto } from '@lib/mocks/mock-attempt-dto';
import type {
  MockAttemptSectionResultDto,
  SubmitMockAttemptSectionRequest,
} from '../../interfaces/mocks/mock-attempt.interface';

export enum SubmitMockAttemptSectionErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_NOT_ACTIVE = 'attempt_not_active',
  SECTION_NOT_FOUND = 'section_not_found',
  SECTION_NOT_STARTED = 'section_not_started',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class SubmitMockAttemptSectionError extends Error {
  constructor(
    message: string,
    readonly code: SubmitMockAttemptSectionErrorCode,
  ) {
    super(message);
    this.name = 'SubmitMockAttemptSectionError';
  }
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null>;
  completeSection(
    sectionId: string,
    data: {
      answers: MockAttemptSectionAnswers;
      rawScore: number;
      maxScore: number;
      gradingFeedback: MockAttemptSectionGradingFeedback;
      completedAt: Date;
    },
  ): Promise<void>;
}

export interface PracticeExercisesRepositoryPort {
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ items: PracticeItem[] } | null>;
}

export interface WritingTasksRepositoryPort {
  findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null>;
}

export interface ListeningItemForGrading {
  id: string;
  answer_key: PracticeItemAnswerKey;
  skill_tags: string[];
}

export interface ListeningSourcesRepositoryPort {
  findItemsWithAnswerKeysBySourceId(sourceId: string): Promise<ListeningItemForGrading[]>;
}

export interface SubmitMockAttemptSectionServiceDeps {
  llm: WritingGradingLLMPort;
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
  practiceExercises?: (dataSource: DataSource) => PracticeExercisesRepositoryPort;
  writingTasks?: (dataSource: DataSource) => WritingTasksRepositoryPort;
  listeningSources?: (dataSource: DataSource) => ListeningSourcesRepositoryPort;
  now?: () => Date;
}

const DEFAULT_MOCK_ATTEMPTS_FACTORY = (dataSource: DataSource): MockAttemptsRepositoryPort =>
  new MockAttemptsRepository(dataSource);
const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  dataSource: DataSource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(dataSource);
const DEFAULT_WRITING_TASKS_FACTORY = (dataSource: DataSource): WritingTasksRepositoryPort =>
  new WritingTasksRepository(dataSource);
const DEFAULT_LISTENING_SOURCES_FACTORY = (
  dataSource: DataSource,
): ListeningSourcesRepositoryPort => new ListeningSourcesRepository(dataSource);

function invalidInput(message: string): never {
  throw new SubmitMockAttemptSectionError(message, SubmitMockAttemptSectionErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function mapWritingError(error: unknown): SubmitMockAttemptSectionError {
  if (error instanceof WritingGradingError) {
    return new SubmitMockAttemptSectionError(
      error.message,
      error.code as unknown as SubmitMockAttemptSectionErrorCode,
    );
  }
  return new SubmitMockAttemptSectionError(
    'The AI provider returned an unexpected error',
    SubmitMockAttemptSectionErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

function buildResultFromSection(section: MockAttemptSection): MockAttemptSectionResultDto {
  if (
    section.raw_score === null ||
    section.max_score === null ||
    section.grading_feedback === null
  ) {
    throw new SubmitMockAttemptSectionError(
      'Mock attempt section is completed but missing its grading result',
      SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
    );
  }
  const rawScore = Number(section.raw_score);
  const maxScore = Number(section.max_score);
  return {
    section: toMockAttemptSectionSafeDto(section),
    percentage: maxScore > 0 ? roundToTwoDecimals((rawScore / maxScore) * 100) : 0,
    feedback: section.grading_feedback,
  };
}

/**
 * Grades one section. Objective sections (Use of English/Reading/Listening)
 * grade with pure local computation (gradeItem/computeFeedbackSummary,
 * lib/practice/practice-attempt-grading.ts) — same as
 * SubmitPracticeAttemptService. Writing sections grade via an LLM call
 * (gradeWritingSubmission, lib/writing/writing-grading.ts — the exact same
 * rubric/schema submit-writing-submission.service.ts uses), which always
 * happens BEFORE any persistence, same house rule as every other generation/
 * grading service in this codebase.
 */
export class SubmitMockAttemptSectionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SubmitMockAttemptSectionServiceDeps,
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    request: SubmitMockAttemptSectionRequest,
    submittedAt: Date,
  ): Promise<MockAttemptSectionResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!isNonEmptyString(sectionCode)) invalidInput('sectionCode is required');
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      invalidInput('submittedAt must be a valid Date');
    }

    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const mockAttemptsRepo = mockAttemptsFactory(this.dataSource);

    const attempt = await mockAttemptsRepo.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new SubmitMockAttemptSectionError(
        'Mock attempt not found',
        SubmitMockAttemptSectionErrorCode.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.status !== MockAttemptStatus.IN_PROGRESS) {
      throw new SubmitMockAttemptSectionError(
        'This mock attempt is not in progress',
        SubmitMockAttemptSectionErrorCode.ATTEMPT_NOT_ACTIVE,
      );
    }

    const section = await mockAttemptsRepo.findSectionByCodeForUser(attemptId, sectionCode, userId);
    if (section === null) {
      throw new SubmitMockAttemptSectionError(
        'Mock attempt section not found',
        SubmitMockAttemptSectionErrorCode.SECTION_NOT_FOUND,
      );
    }
    if (section.status === MockAttemptSectionStatus.COMPLETED) {
      // Idempotent replay: nothing is recomputed or re-graded.
      return buildResultFromSection(section);
    }
    if (section.status === MockAttemptSectionStatus.PENDING) {
      throw new SubmitMockAttemptSectionError(
        'This section has not been started yet',
        SubmitMockAttemptSectionErrorCode.SECTION_NOT_STARTED,
      );
    }

    const catalogEntry = findMockAttemptSectionCatalogEntry(sectionCode);
    if (catalogEntry === undefined) {
      throw new SubmitMockAttemptSectionError(
        'This section is not registered in the mock attempt catalog',
        SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const now = this.deps.now ?? (() => new Date());

    if (catalogEntry.contentType === MockAttemptSectionContentType.WRITING_TASK) {
      if (!('content' in request) || typeof request.content !== 'string') {
        invalidInput('content is required for a writing section');
      }
      const tasksFactory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
      const task = await tasksFactory(this.dataSource).findByIdForUser(
        section.writing_task_id ?? '',
        userId,
      );
      if (task === null) {
        throw new SubmitMockAttemptSectionError(
          'Failed to load this section’s writing task for grading',
          SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }

      let feedback;
      try {
        ({ feedback } = await gradeWritingSubmission(this.deps.llm, task, request.content));
      } catch (err) {
        throw mapWritingError(err);
      }

      const answers: MockAttemptSectionAnswers = { kind: 'writing', content: request.content };
      const gradingFeedback: MockAttemptSectionGradingFeedback = {
        kind: 'writing',
        ...feedback,
      };
      await mockAttemptsRepo.completeSection(section.id, {
        answers,
        rawScore: feedback.overallBand,
        maxScore: feedback.maxBand,
        gradingFeedback,
        completedAt: now(),
      });

      const updated = await mockAttemptsRepo.findSectionByCodeForUser(
        attemptId,
        sectionCode,
        userId,
      );
      if (updated === null) {
        throw new SubmitMockAttemptSectionError(
          'Failed to re-read the mock attempt section after grading',
          SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      return buildResultFromSection(updated);
    }

    // ── objective (practice_exercise / listening) ────────────────────────────

    if (!('answers' in request) || !Array.isArray(request.answers)) {
      invalidInput('answers is required for this section');
    }
    for (const answer of request.answers) {
      if (!isMockAttemptObjectiveAnswer(answer)) invalidInput('answers contains an invalid entry');
    }

    let itemsForGrading: { id: string; answer_key: PracticeItemAnswerKey; skill_tags: string[] }[];
    if (catalogEntry.contentType === MockAttemptSectionContentType.PRACTICE_EXERCISE) {
      const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
      const withKeys = await factory(this.dataSource).findExerciseWithAnswerKeysForEvaluation(
        section.practice_exercise_id ?? '',
        userId,
      );
      if (withKeys === null) {
        throw new SubmitMockAttemptSectionError(
          'Failed to load this section’s exercise for grading',
          SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      itemsForGrading = withKeys.items;
    } else {
      const factory = this.deps.listeningSources ?? DEFAULT_LISTENING_SOURCES_FACTORY;
      itemsForGrading = await factory(this.dataSource).findItemsWithAnswerKeysBySourceId(
        section.listening_source_id ?? '',
      );
    }

    const answersByItemId = new Map(request.answers.map((a) => [a.itemId, a]));
    const gradedItems = itemsForGrading.map((item) => {
      const submitted = answersByItemId.get(item.id);
      const payload = submitted?.answer ?? { kind: 'unanswered' as const };
      const graded = gradeItem(item.answer_key, payload);
      return { item, payload, graded };
    });

    const correctCount = gradedItems.filter((g) => g.graded.isCorrect).length;
    const feedbackSummary = computeFeedbackSummary(
      gradedItems.map((g) => ({
        skillTags: g.item.skill_tags,
        isCorrect: g.graded.isCorrect,
        isUnanswered: g.payload.kind === 'unanswered',
      })),
    );

    const answers: MockAttemptSectionAnswers = {
      kind: 'objective',
      answers: gradedItems.map((g) => ({
        itemId: g.item.id,
        answer: g.payload,
        responseTimeMs: answersByItemId.get(g.item.id)?.responseTimeMs ?? null,
      })),
    };
    const gradingFeedback: MockAttemptSectionGradingFeedback = {
      kind: 'objective',
      ...feedbackSummary,
    };

    await mockAttemptsRepo.completeSection(section.id, {
      answers,
      rawScore: correctCount,
      maxScore: itemsForGrading.length,
      gradingFeedback,
      completedAt: now(),
    });

    const updated = await mockAttemptsRepo.findSectionByCodeForUser(attemptId, sectionCode, userId);
    if (updated === null) {
      throw new SubmitMockAttemptSectionError(
        'Failed to re-read the mock attempt section after grading',
        SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return buildResultFromSection(updated);
  }
}
