import type { EnglishLevel, WritingTaskType } from '../../models/enums';

export interface GenerateWritingTaskRequest {
  taskType: WritingTaskType;
  targetLevel?: EnglishLevel;
  /** Client-supplied. Same key + same user replays the persisted task instead of calling the LLM again. */
  idempotencyKey: string;
}

/** Never carries generationMetadata, userId or soft-delete fields. */
export interface WritingTaskSafeDto {
  id: string;
  taskType: WritingTaskType;
  targetLevel: EnglishLevel | null;
  title: string;
  instructions: string;
  minWords: number;
  maxWords: number;
  timeLimitSeconds: number;
  createdAt: Date;
}
