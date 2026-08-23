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
} from '@models/enums';
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
import { findMockAttemptSectionCatalogEntry } from '@lib/mocks/mock-attempt-catalog';
import { toMockAttemptSafeDto } from '@lib/mocks/mock-attempt-dto';
import type { MockAttemptSafeDto } from '../../interfaces/mocks/mock-attempt.interface';

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

export type MockAttemptPaperGroup = 'reading' | 'useOfEnglish' | 'writing' | 'listening';

export interface MockAttemptPaperScoreDto {
  rawScore: number;
  maxScore: number;
  /** null when no section in this group has been completed yet (e.g. an abandoned attempt). */
  percentage: number | null;
}

export interface MockAttemptResultDto {
  attempt: MockAttemptSafeDto;
  paperScores: Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto>;
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

const PAPER_GROUPS: MockAttemptPaperGroup[] = ['reading', 'useOfEnglish', 'writing', 'listening'];

function emptyPaperScore(): MockAttemptPaperScoreDto {
  return { rawScore: 0, maxScore: 0, percentage: null };
}

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

    return {
      attempt: toMockAttemptSafeDto(attempt, sections),
      paperScores: this.buildPaperScores(sections),
      sections: sectionDetails,
    };
  }

  private buildPaperScores(
    sections: MockAttemptSection[],
  ): Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> {
    const scores: Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> = {
      reading: emptyPaperScore(),
      useOfEnglish: emptyPaperScore(),
      writing: emptyPaperScore(),
      listening: emptyPaperScore(),
    };

    for (const section of sections) {
      if (section.status !== MockAttemptSectionStatus.COMPLETED) continue;
      if (section.raw_score === null || section.max_score === null) continue;

      const catalogEntry = findMockAttemptSectionCatalogEntry(section.section_code);
      if (catalogEntry === undefined) continue;

      const group = scores[catalogEntry.scoreGroup];
      group.rawScore += Number(section.raw_score);
      group.maxScore += Number(section.max_score);
    }

    for (const group of PAPER_GROUPS) {
      const score = scores[group];
      score.percentage =
        score.maxScore > 0 ? roundToTwoDecimals((score.rawScore / score.maxScore) * 100) : null;
    }

    return scores;
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
