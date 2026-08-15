import type { WritingSubmission } from '../models/WritingSubmission';
import type { WritingSubmissionResultDto } from '../interfaces/writing/writing-submission.interface';

/**
 * Builds the result DTO straight from a graded WritingSubmission's own
 * columns — unlike Practice (which reconstructs a result from separate
 * PracticeItem/PracticeAnswer rows), everything a graded Writing submission
 * needs already lives on the submission row itself (submitted_text,
 * word_count, feedback), so there's nothing else to join.
 */
export function buildWritingSubmissionResultDto(
  submission: WritingSubmission,
): WritingSubmissionResultDto {
  if (
    submission.submitted_at === null ||
    submission.duration_seconds === null ||
    submission.submitted_text === null ||
    submission.word_count === null ||
    submission.feedback === null
  ) {
    throw new Error('Cannot build a result DTO from a writing submission that is not graded');
  }

  return {
    submissionId: submission.id,
    taskId: submission.task_id,
    submittedAt: submission.submitted_at,
    durationSeconds: submission.duration_seconds,
    submittedText: submission.submitted_text,
    wordCount: submission.word_count,
    feedback: submission.feedback,
  };
}
