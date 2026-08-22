import type { ExamType, MockAttemptStatus, MockAttemptSectionStatus } from '@models/enums';
import type { MockAttemptSectionContentType } from '@models/enums';
import type { PracticeExerciseSafeWithItems } from '../practice/practice-exercise.interface';
import type { WritingTaskSafeDto } from '../writing/writing-task.interface';
import type { ListeningItemSafeDto } from '@repositories/mocks/listening-sources.repository';
import type { MockAttemptSectionGradingFeedback } from '@models/mock-attempt-json-types';

/** Never carries userId, answer keys, or any content's answerKey/explanation. */
export interface MockAttemptSectionSafeDto {
  sectionCode: string;
  contentType: MockAttemptSectionContentType;
  status: MockAttemptSectionStatus;
  timeLimitSeconds: number;
  startedAt: Date | null;
  completedAt: Date | null;
  rawScore: number | null;
  maxScore: number | null;
}

export interface MockAttemptSafeDto {
  id: string;
  examType: ExamType;
  status: MockAttemptStatus;
  startedAt: Date;
  submittedAt: Date | null;
  resultMockTestId: string | null;
  sections: MockAttemptSectionSafeDto[];
}

export interface MockAttemptStartResultDto {
  attempt: MockAttemptSafeDto;
  resumed: boolean;
}

export interface ListeningSectionVideoDto {
  provider: string;
  externalId: string;
  startSeconds: number;
  endSeconds: number;
}

/** Content for a just-started section — shape depends on contentType. Never carries an answer key. */
export type MockAttemptSectionContentDto =
  | { contentType: 'practice_exercise'; exercise: PracticeExerciseSafeWithItems }
  | { contentType: 'writing_task'; task: WritingTaskSafeDto }
  | {
      contentType: 'listening';
      title: string;
      instructions: string;
      video: ListeningSectionVideoDto;
      items: ListeningItemSafeDto[];
    };

export interface StartMockAttemptSectionResultDto {
  section: MockAttemptSectionSafeDto;
  content: MockAttemptSectionContentDto;
}

export interface SubmitObjectiveSectionAnswerInput {
  itemId: string;
  answer: import('@models/practice-json-types').PracticeAnswerPayload;
  responseTimeMs?: number | null;
}

export type SubmitMockAttemptSectionRequest =
  | { answers: SubmitObjectiveSectionAnswerInput[] }
  | { content: string };

export interface MockAttemptSectionResultDto {
  section: MockAttemptSectionSafeDto;
  percentage: number;
  feedback: MockAttemptSectionGradingFeedback;
}

export interface MockAttemptFinalResultDto {
  attempt: MockAttemptSafeDto;
  mockTestId: string;
}
