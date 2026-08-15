import type { DataSource, EntityManager, Repository } from 'typeorm';
import { WritingTask } from '../models/WritingTask';
import type { WritingTaskType, EnglishLevel, PracticeExerciseSource } from '../models/enums';
import type { WritingTaskGenerationMetadata } from '../models/writing-json-types';
import { isSafeGenerationMetadata } from '../lib/practice-jsonb-validators';
import type { WritingTaskSafeDto } from '../interfaces/writing/writing-task.interface';

interface CreateTaskData {
  userId: string;
  idempotencyKey: string;
  taskType: WritingTaskType;
  targetLevel: EnglishLevel | null;
  title: string;
  instructions: string;
  minWords: number;
  maxWords: number;
  timeLimitSeconds: number;
  source: PracticeExerciseSource;
  model: string | null;
  promptVersion: string | null;
  generationMetadata: WritingTaskGenerationMetadata | null;
}

function toSafeTaskDto(task: WritingTask): WritingTaskSafeDto {
  return {
    id: task.id,
    taskType: task.task_type,
    targetLevel: task.target_level,
    title: task.title,
    instructions: task.instructions,
    minWords: task.min_words,
    maxWords: task.max_words,
    timeLimitSeconds: task.time_limit_seconds,
    createdAt: task.created_at,
  };
}

class WritingTasksRepository {
  private readonly taskRepo: Repository<WritingTask>;

  constructor(dataSource: DataSource | EntityManager) {
    this.taskRepo = dataSource.getRepository(WritingTask);
  }

  async createTask(data: CreateTaskData): Promise<WritingTask> {
    if (!isSafeGenerationMetadata(data.generationMetadata)) {
      throw new Error('generationMetadata contains a forbidden key (secret, prompt or headers)');
    }

    const task = this.taskRepo.create({
      user_id: data.userId,
      idempotency_key: data.idempotencyKey,
      task_type: data.taskType,
      target_level: data.targetLevel,
      title: data.title,
      instructions: data.instructions,
      min_words: data.minWords,
      max_words: data.maxWords,
      time_limit_seconds: data.timeLimitSeconds,
      source: data.source,
      model: data.model,
      prompt_version: data.promptVersion,
      generation_metadata: data.generationMetadata,
    });
    return this.taskRepo.save(task);
  }

  async findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null> {
    return this.taskRepo
      .createQueryBuilder('task')
      .where('task.id = :taskId', { taskId })
      .andWhere('task.user_id = :userId', { userId })
      .andWhere('task.deleted_at IS NULL')
      .getOne();
  }

  /** Ignores soft-deleted rows — matches uq_writing_tasks_user_idempotency (partial, WHERE deleted_at IS NULL). */
  async findByIdempotencyKeyForUser(
    userId: string,
    idempotencyKey: string,
  ): Promise<WritingTask | null> {
    return this.taskRepo
      .createQueryBuilder('task')
      .where('task.user_id = :userId', { userId })
      .andWhere('task.idempotency_key = :idempotencyKey', { idempotencyKey })
      .andWhere('task.deleted_at IS NULL')
      .getOne();
  }

  async findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null> {
    const task = await this.findByIdForUser(taskId, userId);
    return task === null ? null : toSafeTaskDto(task);
  }
}

export { WritingTasksRepository, toSafeTaskDto };
export type { CreateTaskData };
