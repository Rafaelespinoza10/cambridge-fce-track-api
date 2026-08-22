import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import { PracticeAttemptStatus } from '../../models/enums';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { PracticeAttemptViewDto } from '../../interfaces/practice/practice-attempt.interface';
import { toPracticeAttemptSafeDto } from '@lib/practice/practice-attempt-dto';
import { buildPracticeAttemptResultDto } from '@lib/practice/practice-attempt-grading';

export enum GetPracticeAttemptErrorCode {
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
}

export class GetPracticeAttemptError extends Error {
  constructor(
    message: string,
    readonly code: GetPracticeAttemptErrorCode,
  ) {
    super(message);
    this.name = 'GetPracticeAttemptError';
  }
}

export interface PracticeExercisesRepositoryPort {
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ items: PracticeItem[] } | null>;
}

export interface PracticeAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<PracticeAttempt | null>;
}

export interface PracticeAnswersRepositoryPort {
  findByAttemptForUser(attemptId: string, userId: string): Promise<PracticeAnswer[]>;
}

export interface GetPracticeAttemptServiceDeps {
  attempts: PracticeAttemptsRepositoryPort;
  exercises: PracticeExercisesRepositoryPort;
  answers: PracticeAnswersRepositoryPort;
}

/**
 * `in_progress`/`abandoned` -> safe exercise (never an answerKey), result: null.
 * `completed` -> the full, answer-revealing result (the student already submitted).
 */
export class GetPracticeAttemptService {
  constructor(private readonly deps: GetPracticeAttemptServiceDeps) {}

  async execute(userId: string, attemptId: string): Promise<PracticeAttemptViewDto> {
    const attempt = await this.deps.attempts.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new GetPracticeAttemptError(
        'Practice attempt not found',
        GetPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }

    if (attempt.status !== PracticeAttemptStatus.COMPLETED) {
      const exercise = await this.deps.exercises.findSafeExerciseWithItemsForUser(
        attempt.exercise_id,
        userId,
      );
      if (exercise === null) {
        throw new Error('Failed to re-read the exercise for a practice attempt that references it');
      }
      return { attempt: toPracticeAttemptSafeDto(attempt), exercise, result: null };
    }

    const withKeys = await this.deps.exercises.findExerciseWithAnswerKeysForEvaluation(
      attempt.exercise_id,
      userId,
    );
    if (withKeys === null) {
      throw new Error('Failed to re-read the exercise for a completed practice attempt');
    }
    const answers = await this.deps.answers.findByAttemptForUser(attemptId, userId);

    return {
      attempt: toPracticeAttemptSafeDto(attempt),
      exercise: null,
      result: buildPracticeAttemptResultDto(attempt, withKeys.items, answers),
    };
  }
}
