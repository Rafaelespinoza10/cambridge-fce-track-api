import { WritingSubmissionStatus } from '../../models/enums';
import type { WritingSubmission } from '../../models/WritingSubmission';
import { toWritingSubmissionSafeDto } from '@lib/writing/writing-submission-dto';
import type { WritingSubmissionSafeDto } from '../../interfaces/writing/writing-submission.interface';

export enum AbandonWritingSubmissionErrorCode {
  SUBMISSION_NOT_FOUND = 'submission_not_found',
  SUBMISSION_GRADED = 'submission_graded',
}

export class AbandonWritingSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: AbandonWritingSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'AbandonWritingSubmissionError';
  }
}

export interface WritingSubmissionsRepositoryPort {
  findByIdForUser(submissionId: string, userId: string): Promise<WritingSubmission | null>;
  abandonSubmission(submissionId: string, userId: string): Promise<{ affected?: number | null }>;
}

export interface AbandonWritingSubmissionServiceDeps {
  repository: WritingSubmissionsRepositoryPort;
}

/**
 * No transaction/lock needed — `abandonSubmission` is a single conditional
 * `UPDATE ... WHERE status = 'in_progress'`, already atomic on its own.
 * Exists mainly so a submission left in_progress forever (app closed,
 * device lost) doesn't permanently block starting a new one via the
 * one-active-submission-per-user constraint. Mirrors AbandonPracticeAttemptService.
 */
export class AbandonWritingSubmissionService {
  constructor(private readonly deps: AbandonWritingSubmissionServiceDeps) {}

  async execute(
    userId: string,
    submissionId: string,
  ): Promise<{ submission: WritingSubmissionSafeDto; idempotentReplay: boolean }> {
    const submission = await this.deps.repository.findByIdForUser(submissionId, userId);
    if (submission === null) {
      throw new AbandonWritingSubmissionError(
        'Writing submission not found',
        AbandonWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND,
      );
    }
    return this.resolve(submission, userId, submissionId);
  }

  private async resolve(
    submission: WritingSubmission,
    userId: string,
    submissionId: string,
  ): Promise<{ submission: WritingSubmissionSafeDto; idempotentReplay: boolean }> {
    if (submission.status === WritingSubmissionStatus.ABANDONED) {
      return { submission: toWritingSubmissionSafeDto(submission), idempotentReplay: true };
    }
    if (submission.status === WritingSubmissionStatus.GRADED) {
      throw new AbandonWritingSubmissionError(
        'This writing submission is already graded and cannot be abandoned',
        AbandonWritingSubmissionErrorCode.SUBMISSION_GRADED,
      );
    }

    // status === IN_PROGRESS
    const updateResult = await this.deps.repository.abandonSubmission(submissionId, userId);
    if (updateResult.affected !== 1) {
      // Lost a race against a concurrent abandon/submit — re-fetch and
      // branch again instead of assuming this call actually won.
      const refetched = await this.deps.repository.findByIdForUser(submissionId, userId);
      if (refetched === null) {
        throw new AbandonWritingSubmissionError(
          'Writing submission not found',
          AbandonWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND,
        );
      }
      return this.resolve(refetched, userId, submissionId);
    }

    const abandoned = { ...submission, status: WritingSubmissionStatus.ABANDONED };
    return { submission: toWritingSubmissionSafeDto(abandoned), idempotentReplay: false };
  }
}
