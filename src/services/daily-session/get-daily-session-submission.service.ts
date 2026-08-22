import type { DailySessionSubmission } from '../../models/DailySessionSubmission';
import {
  buildDailySessionSubmissionResultDto,
  toDailySessionSubmissionSafeDto,
} from '@lib/daily-session/daily-session-submission-dto';
import type {
  DailySessionSubmissionSafeDto,
  DailySessionSubmissionResultDto,
} from '../../interfaces/daily-session/daily-session.interface';
import { DailySessionSubmissionStatus } from '../../models/enums';

export enum DailySessionSubmissionErrorCode {
  SUBMISSION_NOT_FOUND = 'submission_not_found',
}

export class DailySessionSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: DailySessionSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'DailySessionSubmissionError';
  }
}

export interface DailySessionSubmissionViewDto {
  submission: DailySessionSubmissionSafeDto;
  result: DailySessionSubmissionResultDto | null;
}

interface DailySessionSubmissionsRepositoryPort {
  findByIdForUser(submissionId: string, userId: string): Promise<DailySessionSubmission | null>;
}

export interface GetDailySessionSubmissionServiceDeps {
  repository: DailySessionSubmissionsRepositoryPort;
}

/**
 * Read-only: lets a client revisit a session after leaving the results
 * screen. `result` is populated only once `status === 'graded'` — same
 * "exactly one of two things meaningfully populated, branch on status"
 * shape as PracticeAttemptViewDto — never guessed or partially filled for
 * an in_progress/abandoned submission.
 */
export class GetDailySessionSubmissionService {
  constructor(private readonly deps: GetDailySessionSubmissionServiceDeps) {}

  async getSubmission(
    userId: string,
    submissionId: string,
  ): Promise<DailySessionSubmissionViewDto> {
    const submission = await this.deps.repository.findByIdForUser(submissionId, userId);
    if (submission === null) {
      throw new DailySessionSubmissionError(
        'Daily session submission not found',
        DailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND,
      );
    }

    const result =
      submission.status === DailySessionSubmissionStatus.GRADED
        ? buildDailySessionSubmissionResultDto(submission)
        : null;

    return { submission: toDailySessionSubmissionSafeDto(submission), result };
  }
}
