import type { EnglishLevel } from '../../models/enums';

/** Never `in_progress` — the history listing only ever shows finished attempts. */
export type PracticeAttemptHistoryStatus = 'completed' | 'abandoned';

/**
 * A lightweight per-attempt summary for the history list — never individual
 * answers, answer keys, accepted answers, explanations, the full skill
 * breakdown, generation metadata, model, prompt version, userId or
 * deletedAt. The full graded result (per-item feedback) still only comes
 * from `GET /practice/attempts/{attemptId}`.
 */
export interface PracticeAttemptHistoryItemDto {
  attemptId: string;
  exerciseId: string;

  status: PracticeAttemptHistoryStatus;

  examCode: string;
  paperCode: string;
  partCode: string;
  targetLevel: EnglishLevel | null;

  title: string;
  itemCount: number;

  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | null;

  correctCount: number | null;
  totalCount: number;
  percentage: number | null;

  /** From feedbackSummary.unansweredCount when completed; null for abandoned. */
  unansweredCount: number | null;
}

export interface PracticeAttemptHistoryPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PracticeAttemptHistoryResponseDto {
  items: PracticeAttemptHistoryItemDto[];
  pagination: PracticeAttemptHistoryPagination;
}
