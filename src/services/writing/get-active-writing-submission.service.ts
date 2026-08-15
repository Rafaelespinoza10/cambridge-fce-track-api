import type { WritingSubmission } from '../../models/WritingSubmission';
import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';
import type { WritingSubmissionViewDto } from '../../interfaces/writing/writing-submission.interface';
import { toWritingSubmissionSafeDto } from '../../lib/writing-submission-dto';

export interface WritingTasksRepositoryPort {
  findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null>;
}

export interface WritingSubmissionsRepositoryPort {
  findActiveByUser(userId: string): Promise<WritingSubmission | null>;
}

export interface GetActiveWritingSubmissionServiceDeps {
  repository: WritingSubmissionsRepositoryPort;
  tasksRepository: WritingTasksRepositoryPort;
}

/** No error class — always succeeds with either `{ submission: null }` or a full view. Mirrors GetActivePracticeAttemptService. */
export class GetActiveWritingSubmissionService {
  constructor(private readonly deps: GetActiveWritingSubmissionServiceDeps) {}

  async execute(userId: string): Promise<WritingSubmissionViewDto | { submission: null }> {
    const active = await this.deps.repository.findActiveByUser(userId);
    if (active === null) return { submission: null };

    const task = await this.deps.tasksRepository.findSafeTaskForUser(active.task_id, userId);
    if (task === null) {
      // Unreachable given the composite FK, but fail loudly rather than
      // silently returning a submission with no task.
      throw new Error('Failed to re-read the task for the active writing submission');
    }

    return { submission: toWritingSubmissionSafeDto(active), task, result: null };
  }
}
