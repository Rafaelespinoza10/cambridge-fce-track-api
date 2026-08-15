import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';

export enum WritingTaskErrorCode {
  TASK_NOT_FOUND = 'task_not_found',
}

export class WritingTaskError extends Error {
  constructor(
    message: string,
    readonly code: WritingTaskErrorCode,
  ) {
    super(message);
    this.name = 'WritingTaskError';
  }
}

interface WritingTasksRepositoryPort {
  findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null>;
}

export interface WritingTasksServiceDeps {
  repository: WritingTasksRepositoryPort;
}

/** Thin read wrapper: mirrors PracticeExercisesService. */
export class WritingTasksService {
  constructor(private readonly deps: WritingTasksServiceDeps) {}

  async getTask(userId: string, taskId: string): Promise<WritingTaskSafeDto> {
    const result = await this.deps.repository.findSafeTaskForUser(taskId, userId);
    if (result === null) {
      throw new WritingTaskError('Writing task not found', WritingTaskErrorCode.TASK_NOT_FOUND);
    }
    return result;
  }
}
