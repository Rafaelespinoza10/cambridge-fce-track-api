import type { DataSource } from 'typeorm';
import { MockAttemptsRepository } from '@repositories/mocks/mock-attempts.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import type { ListeningItem } from '@models/ListeningItem';
import {
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
  ExamType,
} from '@models/enums';
import type { EnglishLevel } from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeExercise } from '@models/PracticeExercise';
import type { PracticeItem } from '@models/PracticeItem';
import type { WritingTask } from '@models/WritingTask';
import type { MockAttemptSectionGradingFeedback } from '@models/mock-attempt-json-types';
import {
  gradeItem,
  formatAcceptedAnswers,
  formatUserAnswer,
  roundToTwoDecimals,
} from '@lib/practice/practice-attempt-grading';
import {
  computeMockAttemptPaperScores,
  computeCoveredOverallPercentage,
  type MockAttemptPaperGroup,
  type MockAttemptPaperScoreDto,
} from '@lib/mocks/mock-attempt-paper-scores';
import { estimateB2FirstResult } from '@lib/mocks/estimate-mock-level';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import type { MockAttemptSafeDto } from '../../interfaces/mocks/mock-attempt.interface';

export type { MockAttemptPaperGroup, MockAttemptPaperScoreDto };

export enum GetMockAttemptResultErrorCode {
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_NOT_FINISHED = 'attempt_not_finished',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class GetMockAttemptResultError extends Error {
  constructor(
    message: string,
    readonly code: GetMockAttemptResultErrorCode,
  ) {
    super(message);
    this.name = 'GetMockAttemptResultError';
  }
}

export interface MockAttemptSectionReviewItemDto {
  itemId: string;
  prompt: string;
  options: { id: string; label: string }[] | null;
  correctAnswer: string;
  userAnswer: string;
  isCorrect: boolean;
  explanation: string | null;
  skillTags: string[];
}

export type MockAttemptSectionReviewDto =
  | {
      kind: 'objective';
      stimulus: string | null;
      items: MockAttemptSectionReviewItemDto[];
    }
  | {
      kind: 'writing';
      taskTitle: string;
      taskInstructions: string;
      submittedText: string;
    };

export interface MockAttemptSectionDetailDto {
  sectionCode: string;
  contentType: MockAttemptSectionContentType;
  status: MockAttemptSectionStatus;
  rawScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  feedback: MockAttemptSectionGradingFeedback | null;
  review: MockAttemptSectionReviewDto | null;
}

export interface MockAttemptEstimatedResultDto {
  /** Estimated Cambridge Scale Score (100-190) — an approximation, never an official score. */
  estimatedScore: number;
  estimatedLevel: EnglishLevel;
}

export interface MockAttemptResultDto {
  attempt: MockAttemptSafeDto;
  paperScores: Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto>;
  /** null for an abandoned (incomplete) attempt, or a non-B2_FIRST exam type. */
  estimatedResult: MockAttemptEstimatedResultDto | null;
  sections: MockAttemptSectionDetailDto[];
}

export interface MockAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null>;
  findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]>;
}

export interface PracticeExercisesRepositoryPort {
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ exercise: PracticeExercise; items: PracticeItem[] } | null>;
}

export interface WritingTasksRepositoryPort {
  findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null>;
}

export interface ListeningSourcesRepositoryPort {
  findItemsWithAnswerKeysBySourceId(sourceId: string): Promise<ListeningItem[]>;
}

export interface GetMockAttemptResultServiceDeps {
  mockAttempts?: (dataSource: DataSource) => MockAttemptsRepositoryPort;
  practiceExercises?: (dataSource: DataSource) => PracticeExercisesRepositoryPort;
  writingTasks?: (dataSource: DataSource) => WritingTasksRepositoryPort;
  listeningSources?: (dataSource: DataSource) => ListeningSourcesRepositoryPort;
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

/**
 * Full, answer-revealing detail of one finished mock attempt: every
 * section's grading feedback (same shape SubmitMockAttemptSectionService/
 * GetMockAttemptSectionResultService already return, never duplicated here)
 * PLUS, new in this service, a per-item review (prompt/options/correct vs.
 * given answer/explanation for objective sections, the submitted text for
 * Writing) and the 4 real Cambridge paper-level rollups
 * (reading/useOfEnglish/writing/listening) that MOCK_ATTEMPT_SECTION_CATALOG's
 * `scoreGroup` field was always meant to drive but that, until this service,
 * nothing ever actually computed. Never touches answer_key/explanation for
 * an incomplete section — only 'completed' sections get a `review`.
 */
export class GetMockAttemptResultService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GetMockAttemptResultServiceDeps = {},
  ) {}

  async execute(userId: string, attemptId: string): Promise<MockAttemptResultDto> {
    const mockAttemptsFactory = this.deps.mockAttempts ?? DEFAULT_MOCK_ATTEMPTS_FACTORY;
    const mockAttemptsRepo = mockAttemptsFactory(this.dataSource);

    const attempt = await mockAttemptsRepo.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new GetMockAttemptResultError(
        'Mock attempt not found',
        GetMockAttemptResultErrorCode.ATTEMPT_NOT_FOUND,
      );
    }
    if (attempt.status === MockAttemptStatus.IN_PROGRESS) {
      throw new GetMockAttemptResultError(
        'This mock attempt has not finished yet — finish or abandon it first',
        GetMockAttemptResultErrorCode.ATTEMPT_NOT_FINISHED,
      );
    }

    const sections = await mockAttemptsRepo.findSectionsByAttempt(attemptId);

    const sectionDetails = await Promise.all(
      sections.map((section) => this.buildSectionDetail(userId, section)),
    );

    const paperScores = computeMockAttemptPaperScores(sections);

    return {
      attempt: toMockAttemptSafeDto(attempt, sections),
      paperScores,
      estimatedResult: this.buildEstimatedResult(attempt, paperScores),
      sections: sectionDetails,
    };
  }

  /**
   * Only meaningful once every section is graded (attempt.status ===
   * 'completed' — an abandoned attempt may be missing whole papers) and
   * only for B2 First (the only exam type estimateB2FirstResult has
   * published boundaries for). Scoped to whatever papers were actually
   * covered via computeCoveredOverallPercentage — same as
   * SubmitMockAttemptService, which persists this same estimate onto the
   * MockTest — so a partial sitting (Use of English only, ...) still gets a
   * level instead of silently averaging in the unattempted papers as zeros.
   */
  private buildEstimatedResult(
    attempt: MockAttempt,
    paperScores: Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto>,
  ) {
    if (attempt.status !== MockAttemptStatus.COMPLETED) return null;
    if (attempt.exam_type !== ExamType.B2_FIRST) return null;

    const overallPercentage = computeCoveredOverallPercentage(paperScores);
    if (overallPercentage === null) return null;
    return estimateB2FirstResult(overallPercentage);
  }

  private async buildSectionDetail(
    userId: string,
    section: MockAttemptSection,
  ): Promise<MockAttemptSectionDetailDto> {
    const rawScore = section.raw_score !== null ? Number(section.raw_score) : null;
    const maxScore = section.max_score !== null ? Number(section.max_score) : null;
    const percentage =
      rawScore !== null && maxScore !== null && maxScore > 0
        ? roundToTwoDecimals((rawScore / maxScore) * 100)
        : null;

    const isCompleted = section.status === MockAttemptSectionStatus.COMPLETED;

    // Branch on status, never infer from which field happens to be
    // present — same discipline as GetMockAttemptSectionResultService.
    const base = {
      sectionCode: section.section_code,
      contentType: section.content_type,
      status: section.status,
      rawScore: isCompleted ? rawScore : null,
      maxScore: isCompleted ? maxScore : null,
      percentage: isCompleted ? percentage : null,
      feedback: isCompleted ? section.grading_feedback : null,
    };

    if (!isCompleted || Array.isArray(section.answers)) {
      return { ...base, review: null };
    }

    const review = await this.buildReview(userId, section);
    return { ...base, review };
  }

  private async buildReview(
    userId: string,
    section: MockAttemptSection,
  ): Promise<MockAttemptSectionReviewDto | null> {
    if (Array.isArray(section.answers)) return null;

    if (section.answers.kind === 'writing') {
      const tasksFactory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
      const task = await tasksFactory(this.dataSource).findByIdForUser(
        section.writing_task_id ?? '',
        userId,
      );
      if (task === null) {
        throw new GetMockAttemptResultError(
          'Failed to load this section’s writing task for review',
          GetMockAttemptResultErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      return {
        kind: 'writing',
        taskTitle: task.title,
        taskInstructions: task.instructions,
        submittedText: section.answers.content,
      };
    }

    const answersByItemId = new Map(section.answers.answers.map((a) => [a.itemId, a]));

    if (section.content_type === MockAttemptSectionContentType.PRACTICE_EXERCISE) {
      const factory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
      const withKeys = await factory(this.dataSource).findExerciseWithAnswerKeysForEvaluation(
        section.practice_exercise_id ?? '',
        userId,
      );
      if (withKeys === null) {
        throw new GetMockAttemptResultError(
          'Failed to load this section’s exercise for review',
          GetMockAttemptResultErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      return {
        kind: 'objective',
        stimulus: withKeys.exercise.stimulus,
        items: withKeys.items
          .sort((a, b) => a.position - b.position)
          .map((item) => this.buildReviewItem(item, answersByItemId.get(item.id)?.answer)),
      };
    }

    const listeningFactory = this.deps.listeningSources ?? DEFAULT_LISTENING_SOURCES_FACTORY;
    const items = await listeningFactory(this.dataSource).findItemsWithAnswerKeysBySourceId(
      section.listening_source_id ?? '',
    );
    return {
      kind: 'objective',
      stimulus: null,
      items: items
        .sort((a, b) => a.position - b.position)
        .map((item) => this.buildReviewItem(item, answersByItemId.get(item.id)?.answer)),
    };
  }

  private buildReviewItem(
    item: PracticeItem | ListeningItem,
    payload: import('@models/practice-json-types').PracticeAnswerPayload | undefined,
  ): MockAttemptSectionReviewItemDto {
    const answerPayload = payload ?? { kind: 'unanswered' as const };
    return {
      itemId: item.id,
      prompt: item.prompt,
      options: item.options,
      correctAnswer: formatAcceptedAnswers(item).join(' / '),
      userAnswer: formatUserAnswer(item, answerPayload),
      isCorrect: gradeItem(item.answer_key, answerPayload).isCorrect,
      explanation: item.explanation,
      skillTags: item.skill_tags,
    };
  }
}
