import { WritingSubmissionStatus } from '../../models/enums';
import type { WritingSubmission } from '../../models/WritingSubmission';
import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';
import type { WritingSubmissionViewDto } from '../../interfaces/writing/writing-submission.interface';
import { toWritingSubmissionSafeDto } from '../../lib/writing-submission-dto';
import { buildWritingSubmissionResultDto } from '../../lib/writing-submission-result-dto';

export enum GetWritingSubmissionErrorCode {
  SUBMISSION_NOT_FOUND = 'submission_not_found',
}

export class GetWritingSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: GetWritingSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'GetWritingSubmissionError';
  }
}

export interface WritingTasksRepositoryPort {
  findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null>;
}

export interface WritingSubmissionsRepositoryPort {
  findByIdForUser(submissionId: string, userId: string): Promise<WritingSubmission | null>;
}

export interface GetWritingSubmissionServiceDeps {
  submissions: WritingSubmissionsRepositoryPort;
  tasks: WritingTasksRepositoryPort;
}

/**
 * `in_progress`/`abandoned` -> task + result: null.
 * `graded` -> task + the full result (already on the submission row — see
 * buildWritingSubmissionResultDto).
 */
export class GetWritingSubmissionService {
  constructor(private readonly deps: GetWritingSubmissionServiceDeps) {}

  async execute(userId: string, submissionId: string): Promise<WritingSubmissionViewDto> {
    const submission = await this.deps.submissions.findByIdForUser(submissionId, userId);
    if (submission === null) {
      throw new GetWritingSubmissionError(
        'Writing submission not found',
        GetWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND,
      );
    }

    const task = await this.deps.tasks.findSafeTaskForUser(submission.task_id, userId);
    if (task === null) {
      throw new Error('Failed to re-read the task for a writing submission that references it');
    }

    if (submission.status !== WritingSubmissionStatus.GRADED) {
      return { submission: toWritingSubmissionSafeDto(submission), task, result: null };
    }

    return {
      submission: toWritingSubmissionSafeDto(submission),
      task,
      result: buildWritingSubmissionResultDto(submission),
    };
  }
}
