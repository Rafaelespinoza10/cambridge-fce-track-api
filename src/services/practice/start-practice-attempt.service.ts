import type { DataSource, EntityManager } from 'typeorm';
import { PracticeExercisesRepository } from '../../repositories/practice-exercises.repository';
import { PracticeAttemptsRepository } from '../../repositories/practice-attempts.repository';
import type { CreateAttemptData } from '../../repositories/practice-attempts.repository';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { PracticeAttemptStartResultDto } from '../../interfaces/practice/practice-attempt.interface';
import { toPracticeAttemptSafeDto } from '../../lib/practice-attempt-dto';

export enum StartPracticeAttemptErrorCode {
  INVALID_INPUT = 'invalid_input',
  EXERCISE_NOT_FOUND = 'exercise_not_found',
  ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE = 'active_attempt_on_another_exercise',
  RACE_UNRESOLVED = 'race_unresolved',
}

export class StartPracticeAttemptError extends Error {
  constructor(
    message: string,
    readonly code: StartPracticeAttemptErrorCode,
  ) {
    super(message);
    this.name = 'StartPracticeAttemptError';
  }
}

type RepositorySource = DataSource | EntityManager;

export interface PracticeExercisesRepositoryPort {
  findByIdForUser(exerciseId: string, userId: string): Promise<PracticeExercise | null>;
  findSafeExerciseWithItemsForUser(
    exerciseId: string,
    userId: string,
  ): Promise<PracticeExerciseSafeWithItems | null>;
}

export interface PracticeAttemptsRepositoryPort {
  findActiveByUser(userId: string): Promise<PracticeAttempt | null>;
  createAttempt(data: CreateAttemptData): Promise<PracticeAttempt>;
}

export interface StartPracticeAttemptServiceDeps {
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
  practiceAttempts?: (source: RepositorySource) => PracticeAttemptsRepositoryPort;
}

const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);
const DEFAULT_PRACTICE_ATTEMPTS_FACTORY = (
  source: RepositorySource,
): PracticeAttemptsRepositoryPort => new PracticeAttemptsRepository(source);

const MAX_RACE_RETRIES = 1;
const ACTIVE_ATTEMPT_CONSTRAINT_NAME = 'uq_practice_attempts_one_active_per_user';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

// Same detection pattern as StartFlashcardReviewSessionService/idempotency
// handling elsewhere in this codebase — matches on the specific constraint
// name, not just the Postgres error code.
function isActiveAttemptConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === ACTIVE_ATTEMPT_CONSTRAINT_NAME;
}

function invalidInput(message: string): never {
  throw new StartPracticeAttemptError(message, StartPracticeAttemptErrorCode.INVALID_INPUT);
}

/**
 * Starts a new attempt or resumes the existing one, per the one-active-
 * attempt-per-user constraint (see AddPracticeDomain migration, PR 1):
 *   - active attempt on the SAME exercise  -> resume it (resumed: true)
 *   - active attempt on a DIFFERENT exercise -> reject (409)
 *   - no active attempt -> create one
 */
export class StartPracticeAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: StartPracticeAttemptServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    exerciseId: string,
    startedAt: Date,
  ): Promise<PracticeAttemptStartResultDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (typeof exerciseId !== 'string' || exerciseId.trim() === '') {
      invalidInput('exerciseId is required');
    }
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
      invalidInput('startedAt must be a valid Date');
    }

    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const exercise = await exercisesFactory(this.dataSource).findByIdForUser(exerciseId, userId);
    if (exercise === null) {
      throw new StartPracticeAttemptError(
        'Practice exercise not found',
        StartPracticeAttemptErrorCode.EXERCISE_NOT_FOUND,
      );
    }

    return this.executeWithRetry(userId, exercise, startedAt, 0);
  }

  /**
   * Two concurrent requests can both see "no active attempt" and both reach
   * createAttempt — exactly one wins, the other's transaction aborts on
   * uq_practice_attempts_one_active_per_user. Retrying the whole transaction
   * once (not just re-querying outside it) is simpler than reconstructing
   * the result by hand: the retry's findActiveByUser sees the race winner
   * and naturally takes the resume-or-409 branch. Same pattern as
   * StartFlashcardReviewSessionService.
   */
  private async executeWithRetry(
    userId: string,
    exercise: PracticeExercise,
    startedAt: Date,
    attempt: number,
  ): Promise<PracticeAttemptStartResultDto> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.runInTransaction(manager, userId, exercise, startedAt),
      );
    } catch (error) {
      if (isActiveAttemptConstraintViolation(error)) {
        if (attempt < MAX_RACE_RETRIES) {
          return this.executeWithRetry(userId, exercise, startedAt, attempt + 1);
        }
        throw new StartPracticeAttemptError(
          'Could not resolve the active practice attempt after a race retry',
          StartPracticeAttemptErrorCode.RACE_UNRESOLVED,
        );
      }
      throw error;
    }
  }

  private async runInTransaction(
    manager: EntityManager,
    userId: string,
    exercise: PracticeExercise,
    startedAt: Date,
  ): Promise<PracticeAttemptStartResultDto> {
    const attemptsFactory = this.deps.practiceAttempts ?? DEFAULT_PRACTICE_ATTEMPTS_FACTORY;
    const attemptsRepo = attemptsFactory(manager);

    const active = await attemptsRepo.findActiveByUser(userId);
    if (active !== null) {
      if (active.exercise_id === exercise.id) {
        return this.buildResult(manager, active, true);
      }
      throw new StartPracticeAttemptError(
        'You already have an active practice attempt on a different exercise',
        StartPracticeAttemptErrorCode.ACTIVE_ATTEMPT_ON_ANOTHER_EXERCISE,
      );
    }

    const created = await attemptsRepo.createAttempt({
      userId,
      exerciseId: exercise.id,
      startedAt,
      totalCount: exercise.item_count,
    });
    return this.buildResult(manager, created, false);
  }

  private async buildResult(
    source: RepositorySource,
    attempt: PracticeAttempt,
    resumed: boolean,
  ): Promise<PracticeAttemptStartResultDto> {
    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const exercise = await exercisesFactory(source).findSafeExerciseWithItemsForUser(
      attempt.exercise_id,
      attempt.user_id,
    );
    if (exercise === null) {
      // Unreachable given the composite FK (attempt.exercise_id, user_id) ->
      // practice_exercises(id, user_id), but fail loudly instead of
      // returning a result with no exercise.
      throw new Error('Failed to re-read the exercise for a practice attempt that references it');
    }
    return {
      view: { attempt: toPracticeAttemptSafeDto(attempt), exercise, result: null },
      resumed,
    };
  }
}
