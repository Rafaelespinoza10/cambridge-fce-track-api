import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
} from '../../services/practice/generate-practice-exercise.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const GENERATE_PRACTICE_EXERCISE_STATUS_BY_CODE: Record<GeneratePracticeExerciseErrorCode, number> =
  {
    [GeneratePracticeExerciseErrorCode.INVALID_INPUT]: 400,
    [GeneratePracticeExerciseErrorCode.AI_RATE_LIMITED]: 429,
    [GeneratePracticeExerciseErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
    [GeneratePracticeExerciseErrorCode.AI_REQUEST_TIMEOUT]: 504,
    [GeneratePracticeExerciseErrorCode.AI_CONFIGURATION_ERROR]: 500,
    [GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE]: 502,
    [GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES]: 404,
  };

function mapGeneratePracticeExerciseError(error: unknown): unknown {
  if (error instanceof GeneratePracticeExerciseError) {
    return httpError(error.message, GENERATE_PRACTICE_EXERCISE_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapGeneratePracticeExerciseError };
