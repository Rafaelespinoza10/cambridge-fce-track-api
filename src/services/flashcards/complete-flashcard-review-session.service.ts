import type { DataSource, EntityManager, UpdateResult } from 'typeorm';

import { StudySessionsRepository } from '@repositories/flashcards/study-sessions.repository';
import { FlashcardReviewsRepository } from '@repositories/flashcards/flashcard-reviews.repository';

import { StudySessionStatus } from '../../models/enums';
import type { StudySession } from '../../models/StudySession';
import type { FlashcardReview } from '../../models/FlashcardReview';
import type {
  CompleteFlashcardReviewSessionInput,
  CompleteFlashcardReviewSessionResult,
} from '../../interfaces/flashcards/complete-flashcard-review-session.interface';

export enum CompleteFlashcardReviewSessionErrorCode {
  INVALID_INPUT = 'invalid_input',
  SESSION_NOT_FOUND = 'session_not_found',
  INVALID_SESSION_STATUS = 'invalid_session_status',
  SESSION_START_TIME_MISSING = 'session_start_time_missing',
  COMPLETION_BEFORE_SESSION_START = 'completion_before_session_start',
  COMPLETION_BEFORE_LAST_REVIEW = 'completion_before_last_review',
  SESSION_COMPLETION_CONFLICT = 'session_completion_conflict',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class CompleteFlashcardReviewSessionError extends Error {
  constructor(
    message: string,
    readonly code: CompleteFlashcardReviewSessionErrorCode,
  ) {
    super(message);
    this.name = 'CompleteFlashcardReviewSessionError';
  }
}

interface StudySessionsRepositoryPort {
  findFlashcardSessionByIdForUpdate(
    studySessionId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<StudySession | null>;
  markCompleted(
    studySessionId: string,
    userId: string,
    endedAt: Date,
    durationMinutes: number,
  ): Promise<UpdateResult>;
}

interface FlashcardReviewsRepositoryPort {
  countBySession(studySessionId: string, userId: string): Promise<number>;
  findLatestBySession(studySessionId: string, userId: string): Promise<FlashcardReview | null>;
}

type RepositorySource = DataSource | EntityManager;

interface CompleteFlashcardReviewSessionServiceDeps {
  studySessions: (source: RepositorySource) => StudySessionsRepositoryPort;
  flashcardReviews: (source: RepositorySource) => FlashcardReviewsRepositoryPort;
}

const DEFAULT_DEPS: CompleteFlashcardReviewSessionServiceDeps = {
  studySessions: (source) => new StudySessionsRepository(source),
  flashcardReviews: (source) => new FlashcardReviewsRepository(source),
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function validateInput(input: CompleteFlashcardReviewSessionInput): void {
  if (!isNonEmptyString(input.userId)) {
    throw new CompleteFlashcardReviewSessionError(
      'userId is required',
      CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  }
  if (!isNonEmptyString(input.studySessionId)) {
    throw new CompleteFlashcardReviewSessionError(
      'studySessionId is required',
      CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  }
  if (!isValidDate(input.completedAt)) {
    throw new CompleteFlashcardReviewSessionError(
      'completedAt must be a valid Date',
      CompleteFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  }
}

class CompleteFlashcardReviewSessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: CompleteFlashcardReviewSessionServiceDeps = DEFAULT_DEPS,
  ) {}

  async execute(
    input: CompleteFlashcardReviewSessionInput,
  ): Promise<CompleteFlashcardReviewSessionResult> {
    validateInput(input);
    return this.dataSource.transaction((manager) => this.runInTransaction(manager, input));
  }

  private async runInTransaction(
    manager: EntityManager,
    input: CompleteFlashcardReviewSessionInput,
  ): Promise<CompleteFlashcardReviewSessionResult> {
    const sessionsRepo = this.deps.studySessions(manager);
    const reviewsRepo = this.deps.flashcardReviews(manager);

    const session = await sessionsRepo.findFlashcardSessionByIdForUpdate(
      input.studySessionId,
      input.userId,
      manager,
    );
    if (session === null) {
      throw new CompleteFlashcardReviewSessionError(
        'Study session not found',
        CompleteFlashcardReviewSessionErrorCode.SESSION_NOT_FOUND,
      );
    }

    if (session.status === StudySessionStatus.COMPLETED) {
      if (
        session.started_at === null ||
        session.ended_at === null ||
        session.duration_minutes === null
      ) {
        throw new CompleteFlashcardReviewSessionError(
          'Completed flashcard review session is missing started_at/ended_at/duration_minutes',
          CompleteFlashcardReviewSessionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }
      const reviewsCount = await reviewsRepo.countBySession(input.studySessionId, input.userId);
      return {
        session: {
          id: session.id,
          status: session.status,
          startedAt: session.started_at,
          endedAt: session.ended_at,
          durationMinutes: session.duration_minutes,
        },
        summary: { reviewsCount },
        idempotentReplay: true,
      };
    }

    if (session.status !== StudySessionStatus.ACTIVE) {
      throw new CompleteFlashcardReviewSessionError(
        'Study session is not active',
        CompleteFlashcardReviewSessionErrorCode.INVALID_SESSION_STATUS,
      );
    }

    if (session.started_at === null) {
      throw new CompleteFlashcardReviewSessionError(
        'Active flashcard review session has no started_at',
        CompleteFlashcardReviewSessionErrorCode.SESSION_START_TIME_MISSING,
      );
    }
    const startedAt = session.started_at;
    if (input.completedAt.getTime() < startedAt.getTime()) {
      throw new CompleteFlashcardReviewSessionError(
        'completedAt is before the session started_at',
        CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_SESSION_START,
      );
    }
    const latestReview = await reviewsRepo.findLatestBySession(input.studySessionId, input.userId);
    if (latestReview !== null && input.completedAt.getTime() < latestReview.reviewed_at.getTime()) {
      throw new CompleteFlashcardReviewSessionError(
        'completedAt is before the latest recorded review',
        CompleteFlashcardReviewSessionErrorCode.COMPLETION_BEFORE_LAST_REVIEW,
      );
    }

    const elapsedMilliseconds = input.completedAt.getTime() - startedAt.getTime();
    const calculatedMinutes = Math.floor(elapsedMilliseconds / 60_000);
    const finalDurationMinutes = Math.max(session.duration_minutes ?? 0, calculatedMinutes);

    const reviewsCount = await reviewsRepo.countBySession(input.studySessionId, input.userId);

    const updateResult = await sessionsRepo.markCompleted(
      input.studySessionId,
      input.userId,
      input.completedAt,
      finalDurationMinutes,
    );
    if (updateResult.affected !== 1) {
      throw new CompleteFlashcardReviewSessionError(
        'Study session completion affected an unexpected number of rows',
        CompleteFlashcardReviewSessionErrorCode.SESSION_COMPLETION_CONFLICT,
      );
    }

    return {
      session: {
        id: session.id,
        status: StudySessionStatus.COMPLETED,
        startedAt,
        endedAt: input.completedAt,
        durationMinutes: finalDurationMinutes,
      },
      summary: { reviewsCount },
      idempotentReplay: false,
    };
  }
}

export { CompleteFlashcardReviewSessionService };
export type {
  StudySessionsRepositoryPort,
  FlashcardReviewsRepositoryPort,
  CompleteFlashcardReviewSessionServiceDeps,
};
