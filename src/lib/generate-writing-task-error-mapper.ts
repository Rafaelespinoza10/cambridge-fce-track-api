import {
  GenerateWritingTaskError,
  GenerateWritingTaskErrorCode,
} from '../services/writing/generate-writing-task.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const GENERATE_WRITING_TASK_STATUS_BY_CODE: Record<GenerateWritingTaskErrorCode, number> = {
  [GenerateWritingTaskErrorCode.INVALID_INPUT]: 400,
  [GenerateWritingTaskErrorCode.AI_RATE_LIMITED]: 429,
  [GenerateWritingTaskErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GenerateWritingTaskErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GenerateWritingTaskErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE]: 502,
};

function mapGenerateWritingTaskError(error: unknown): unknown {
  if (error instanceof GenerateWritingTaskError) {
    return httpError(error.message, GENERATE_WRITING_TASK_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapGenerateWritingTaskError };
