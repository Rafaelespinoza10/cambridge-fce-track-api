import type { DailySessionSubmission } from '@models/DailySessionSubmission';
import type {
  DailySessionSubmissionSafeDto,
  DailySessionSubmissionResultDto,
} from '../../interfaces/daily-session/daily-session.interface';

/** Never carries userId or soft-delete fields. Shared by every submission service. */
export function toDailySessionSubmissionSafeDto(
  submission: DailySessionSubmission,
): DailySessionSubmissionSafeDto {
  return {
    id: submission.id,
    dailySessionId: submission.daily_session_id,
    status: submission.status,
    startedAt: submission.started_at,
  };
}

/**
 * Builds the result DTO straight from a graded DailySessionSubmission's own
 * columns — everything a graded submission needs already lives on the row
 * itself, so there's nothing else to join.
 */
export function buildDailySessionSubmissionResultDto(
  submission: DailySessionSubmission,
): DailySessionSubmissionResultDto {
  if (
    submission.submitted_at === null ||
    submission.duration_seconds === null ||
    submission.comprehension_answers === null ||
    submission.comprehension_correct_count === null ||
    submission.comprehension_total_count === null ||
    submission.comprehension_percentage === null ||
    submission.sentence_submissions === null ||
    submission.sentence_feedback === null
  ) {
    throw new Error('Cannot build a result DTO from a daily session submission that is not graded');
  }

  return {
    submissionId: submission.id,
    dailySessionId: submission.daily_session_id,
    submittedAt: submission.submitted_at,
    durationSeconds: submission.duration_seconds,
    comprehensionAnswers: submission.comprehension_answers,
    comprehensionCorrectCount: submission.comprehension_correct_count,
    comprehensionTotalCount: submission.comprehension_total_count,
    comprehensionPercentage: Number(submission.comprehension_percentage),
    sentenceSubmissions: submission.sentence_submissions,
    sentenceFeedback: submission.sentence_feedback,
  };
}
