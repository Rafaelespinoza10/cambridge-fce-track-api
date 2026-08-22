import { WritingTaskError, WritingTaskErrorCode } from '../../services/writing/writing-tasks.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const WRITING_TASK_STATUS_BY_CODE: Record<WritingTaskErrorCode, number> = {
  [WritingTaskErrorCode.TASK_NOT_FOUND]: 404,
};

function mapWritingTaskError(error: unknown): unknown {
  if (error instanceof WritingTaskError) {
    return httpError(error.message, WRITING_TASK_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapWritingTaskError };
