import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { PracticeAttemptViewDto } from '../../interfaces/practice/practice-attempt.interface';
import { toPracticeAttemptSafeDto } from '../../lib/practice-attempt-dto';

export interface PracticeExercisesRepositoryPort {
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
}

export interface PracticeAttemptsRepositoryPort {
  findActiveByUser(userId: string): Promise<PracticeAttempt | null>;
}

export interface GetActivePracticeAttemptServiceDeps {
  repository: PracticeAttemptsRepositoryPort;
  exercisesRepository: PracticeExercisesRepositoryPort;
}

/** No error class — always succeeds with either `{ attempt: null }` or a full view. */
export class GetActivePracticeAttemptService {
  constructor(private readonly deps: GetActivePracticeAttemptServiceDeps) {}

  async execute(userId: string): Promise<PracticeAttemptViewDto | { attempt: null }> {
    const active = await this.deps.repository.findActiveByUser(userId);
    if (active === null) return { attempt: null };

    const exercise = await this.deps.exercisesRepository.findSafeExerciseWithItemsForUser(
      active.exercise_id,
      userId,
    );
    if (exercise === null) {
      // Unreachable given the composite FK, but fail loudly rather than
      // silently returning an attempt with no exercise.
      throw new Error('Failed to re-read the exercise for the active practice attempt');
    }

    return { attempt: toPracticeAttemptSafeDto(active), exercise, result: null };
  }
}
