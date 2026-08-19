import type { WritingSubmissionStatus, WritingTaskType } from '../../models/enums';

/** Never `in_progress` — the history listing only ever shows finished submissions. */
export type WritingSubmissionHistoryStatus = Extract<
  WritingSubmissionStatus,
  'graded' | 'abandoned'
>;

/**
 * A lightweight per-submission summary for the history list — never the
 * submitted text, per-criterion feedback, corrections, or rewritten text.
 * The full graded result still only comes from
 * GET /writing/submissions/{submissionId}.
 */
export interface WritingSubmissionHistoryItemDto {
  submissionId: string;
  taskId: string;
  taskType: WritingTaskType;
  title: string;
  status: WritingSubmissionHistoryStatus;
  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | null;
  wordCount: number | null;
  overallBand: number | null;
  maxBand: number | null;
}

export interface WritingSubmissionHistoryPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface WritingSubmissionHistoryResponseDto {
  items: WritingSubmissionHistoryItemDto[];
  pagination: WritingSubmissionHistoryPagination;
}
