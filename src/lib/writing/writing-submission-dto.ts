import type { WritingSubmission } from '@models/WritingSubmission';
import type { WritingSubmissionSafeDto } from '../../interfaces/writing/writing-submission.interface';

/** Never carries userId or soft-delete fields. Shared by every submission service. */
export function toWritingSubmissionSafeDto(
  submission: WritingSubmission,
): WritingSubmissionSafeDto {
  return {
    id: submission.id,
    taskId: submission.task_id,
    status: submission.status,
    startedAt: submission.started_at,
  };
}
