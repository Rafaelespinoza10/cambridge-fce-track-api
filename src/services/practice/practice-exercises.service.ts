import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';

export enum PracticeExerciseErrorCode {
  EXERCISE_NOT_FOUND = 'exercise_not_found',
}

export class PracticeExerciseError extends Error {
  constructor(
    message: string,
    readonly code: PracticeExerciseErrorCode,
  ) {
    super(message);
    this.name = 'PracticeExerciseError';
  }
}

interface PracticeExercisesRepositoryPort {
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
}

export interface PracticeExercisesServiceDeps {
  repository: PracticeExercisesRepositoryPort;
}

/** Thin read wrapper: never selects/exposes answerKey or explanation (see the repository method it calls). */
export class PracticeExercisesService {
  constructor(private readonly deps: PracticeExercisesServiceDeps) {}

  async getExercise(userId: string, exerciseId: string): Promise<PracticeExerciseSafeWithItems> {
    const result = await this.deps.repository.findSafeExerciseWithItemsForUser(exerciseId, userId);
    if (result === null) {
      throw new PracticeExerciseError(
        'Practice exercise not found',
        PracticeExerciseErrorCode.EXERCISE_NOT_FOUND,
      );
    }
    return result;
  }
}
