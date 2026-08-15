import type { WritingSubmissionStatus } from '../../models/enums';
import type { WritingFeedback } from '../../models/writing-json-types';
import type { WritingTaskSafeDto } from './writing-task.interface';

export interface SubmitWritingSubmissionRequest {
  submittedText: string;
}

/** Never carries userId or soft-delete fields. */
export interface WritingSubmissionSafeDto {
  id: string;
  taskId: string;
  status: WritingSubmissionStatus;
  startedAt: Date;
}

export interface WritingSubmissionResultDto {
  submissionId: string;
  taskId: string;
  submittedAt: Date;
  durationSeconds: number;
  submittedText: string;
  wordCount: number;
  feedback: WritingFeedback;
}

/**
 * `task` is always populated (unlike Practice's PracticeAttemptViewDto,
 * which nulls out `exercise` once completed) — Writing has no per-item
 * result that already re-embeds the prompt, so the results screen needs the
 * task's title/instructions to show what the student was asked to write.
 * `result` is populated only once `status` is 'graded'.
 */
export interface WritingSubmissionViewDto {
  submission: WritingSubmissionSafeDto;
  task: WritingTaskSafeDto;
  result: WritingSubmissionResultDto | null;
}

export interface WritingSubmissionStartResultDto {
  view: WritingSubmissionViewDto;
  resumed: boolean;
}

export interface WritingSubmissionSubmitResultDto {
  result: WritingSubmissionResultDto;
  idempotentReplay: boolean;
}
