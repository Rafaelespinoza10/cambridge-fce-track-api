import {
  PracticeExerciseError,
  PracticeExerciseErrorCode,
} from '../services/practice/practice-exercises.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const PRACTICE_EXERCISE_STATUS_BY_CODE: Record<PracticeExerciseErrorCode, number> = {
  [PracticeExerciseErrorCode.EXERCISE_NOT_FOUND]: 404,
};

function mapPracticeExerciseError(error: unknown): unknown {
  if (error instanceof PracticeExerciseError) {
    return httpError(error.message, PRACTICE_EXERCISE_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapPracticeExerciseError };
