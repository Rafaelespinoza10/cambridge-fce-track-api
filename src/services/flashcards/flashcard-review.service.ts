import type { DataSource, EntityManager, UpdateResult } from 'typeorm';

import { FlashcardsRepository } from '@repositories/flashcards/flashcards.repository';
import type { UpdateSchedulingStateData } from '@repositories/flashcards/flashcards.repository';
import { FlashcardReviewsRepository } from '@repositories/flashcards/flashcard-reviews.repository';
import type { CreateFlashcardReviewData } from '@repositories/flashcards/flashcard-reviews.repository';
import { DailyReviewStatsRepository } from '@repositories/flashcards/daily-review-stats.repository';
import type { IncrementDailyReviewStatData } from '@repositories/flashcards/daily-review-stats.repository';
import { DecksRepository } from '@repositories/decks/decks.repository';
import { StudySessionsRepository } from '@repositories/flashcards/study-sessions.repository';
import type { UpdateStudySessionProgressData } from '@repositories/flashcards/study-sessions.repository';

import { SimpleSchedulingStrategy } from './scheduling/simple-scheduling.strategy';
import type { SchedulingStrategy, FlashcardSchedulingState } from './scheduling/scheduling.types';

import { FlashcardStatus, StudySessionStatus, ReviewRating } from '../../models/enums';
import type { Flashcard } from '../../models/Flashcard';
import type { Deck } from '../../models/Deck';
import type { StudySession } from '../../models/StudySession';
import type { DailyReviewStat } from '../../models/DailyReviewStat';
import type { FlashcardReview } from '../../models/FlashcardReview';
import type {
  AnswerFlashcardInput,
  AnswerFlashcardResult,
} from '../../interfaces/flashcards/flashcard-review.interface';

export enum FlashcardReviewErrorCode {
  INVALID_INPUT = 'invalid_input',
  SESSION_NOT_FOUND = 'session_not_found',
  SESSION_NOT_ACTIVE = 'session_not_active',
  DAILY_STAT_NOT_FOUND = 'daily_stat_not_found',
  FLASHCARD_NOT_FOUND = 'flashcard_not_found',
  FLASHCARD_SUSPENDED = 'flashcard_suspended',
  DECK_UNAVAILABLE = 'deck_unavailable',
  INVALID_EASE_FACTOR = 'invalid_ease_factor',
  CONCURRENT_UPDATE_CONFLICT = 'concurrent_update_conflict',
}

export class FlashcardReviewError extends Error {
  constructor(
    message: string,
    readonly code: FlashcardReviewErrorCode,
  ) {
    super(message);
    this.name = 'FlashcardReviewError';
  }
}

interface FlashcardsRepositoryPort {
  findByIdForUpdate(
    flashcardId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<Flashcard | null>;
  updateSchedulingState(
    flashcardId: string,
    userId: string,
    data: UpdateSchedulingStateData,
  ): Promise<UpdateResult>;
}

interface FlashcardReviewsRepositoryPort {
  findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<FlashcardReview | null>;
  existsForFlashcardOnDate(
    userId: string,
    flashcardId: string,
    dayStartedAt: Date,
    dayEndedAt: Date,
  ): Promise<boolean>;
  createReview(data: CreateFlashcardReviewData): Promise<FlashcardReview>;
  countBySession(studySessionId: string, userId: string): Promise<number>;
}

interface DailyReviewStatsRepositoryPort {
  findByUserAndDate(userId: string, localDate: string): Promise<DailyReviewStat | null>;
  incrementCounters(
    userId: string,
    localDate: string,
    delta: IncrementDailyReviewStatData,
  ): Promise<UpdateResult>;
  markGoalCompleted(userId: string, localDate: string): Promise<UpdateResult>;
}

interface DecksRepositoryPort {
  findActiveByIdAndUser(deckId: string, userId: string): Promise<Deck | null>;
}

interface StudySessionsRepositoryPort {
  findByIdAndUser(studySessionId: string, userId: string): Promise<StudySession | null>;
  updateSessionProgress(
    studySessionId: string,
    userId: string,
    data: UpdateStudySessionProgressData,
  ): Promise<UpdateResult>;
}

type RepositorySource = DataSource | EntityManager;

interface FlashcardReviewServiceDeps {
  flashcards: (source: RepositorySource) => FlashcardsRepositoryPort;
  flashcardReviews: (source: RepositorySource) => FlashcardReviewsRepositoryPort;
  dailyReviewStats: (source: RepositorySource) => DailyReviewStatsRepositoryPort;
  decks: (source: RepositorySource) => DecksRepositoryPort;
  studySessions: (source: RepositorySource) => StudySessionsRepositoryPort;
}

const DEFAULT_DEPS: FlashcardReviewServiceDeps = {
  flashcards: (source) => new FlashcardsRepository(source),
  flashcardReviews: (source) => new FlashcardReviewsRepository(source),
  dailyReviewStats: (source) => new DailyReviewStatsRepository(source),
  decks: (source) => new DecksRepository(source),
  studySessions: (source) => new StudySessionsRepository(source),
};

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_RATINGS = new Set<string>(Object.values(ReviewRating));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function validateInput(input: AnswerFlashcardInput): void {
  if (!isNonEmptyString(input.userId)) {
    throw new FlashcardReviewError('userId is required', FlashcardReviewErrorCode.INVALID_INPUT);
  }
  if (!isNonEmptyString(input.studySessionId)) {
    throw new FlashcardReviewError(
      'studySessionId is required',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (!isNonEmptyString(input.flashcardId)) {
    throw new FlashcardReviewError(
      'flashcardId is required',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (!isNonEmptyString(input.idempotencyKey)) {
    throw new FlashcardReviewError(
      'idempotencyKey is required',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (!VALID_RATINGS.has(input.rating)) {
    throw new FlashcardReviewError(
      `Invalid rating: ${String(input.rating)}`,
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (!isValidDate(input.reviewedAt)) {
    throw new FlashcardReviewError(
      'reviewedAt must be a valid Date',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (!isNonEmptyString(input.localDate) || !LOCAL_DATE_PATTERN.test(input.localDate)) {
    throw new FlashcardReviewError(
      'localDate must be in YYYY-MM-DD format',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (!isValidDate(input.dayStartedAt) || !isValidDate(input.dayEndedAt)) {
    throw new FlashcardReviewError(
      'dayStartedAt and dayEndedAt must be valid Dates',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (input.dayStartedAt.getTime() >= input.dayEndedAt.getTime()) {
    throw new FlashcardReviewError(
      'dayStartedAt must be before dayEndedAt',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
  if (
    input.responseTimeMs !== undefined &&
    (!Number.isInteger(input.responseTimeMs) || input.responseTimeMs < 0)
  ) {
    throw new FlashcardReviewError(
      'responseTimeMs must be a non-negative integer',
      FlashcardReviewErrorCode.INVALID_INPUT,
    );
  }
}

const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_flashcard_reviews_idempotency';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

function isIdempotencyConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === IDEMPOTENCY_CONSTRAINT_NAME;
}

class FlashcardReviewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly schedulingStrategy: SchedulingStrategy = new SimpleSchedulingStrategy(),
    private readonly deps: FlashcardReviewServiceDeps = DEFAULT_DEPS,
  ) {}

  async answerCard(input: AnswerFlashcardInput): Promise<AnswerFlashcardResult> {
    validateInput(input);

    try {
      return await this.dataSource.transaction((manager) => this.executeAnswerCard(manager, input));
    } catch (error) {
      if (isIdempotencyConstraintViolation(error)) {
        return this.buildReplayResult(this.dataSource, input);
      }
      throw error;
    }
  }

  private async executeAnswerCard(
    manager: EntityManager,
    input: AnswerFlashcardInput,
  ): Promise<AnswerFlashcardResult> {
    const reviewsRepo = this.deps.flashcardReviews(manager);
    const flashcardsRepo = this.deps.flashcards(manager);
    const decksRepo = this.deps.decks(manager);
    const statsRepo = this.deps.dailyReviewStats(manager);
    const sessionsRepo = this.deps.studySessions(manager);

    // 2. Idempotencia
    const existingReview = await reviewsRepo.findByIdempotencyKey(
      input.userId,
      input.idempotencyKey,
    );
    if (existingReview !== null) {
      return this.buildReplayResult(manager, input);
    }

    // 3. Sesión
    const session = await sessionsRepo.findByIdAndUser(input.studySessionId, input.userId);
    if (session === null) {
      throw new FlashcardReviewError(
        'Study session not found',
        FlashcardReviewErrorCode.SESSION_NOT_FOUND,
      );
    }
    if (session.status !== StudySessionStatus.ACTIVE) {
      throw new FlashcardReviewError(
        'Study session is not active',
        FlashcardReviewErrorCode.SESSION_NOT_ACTIVE,
      );
    }

    // 4. DailyReviewStat
    const dailyStat = await statsRepo.findByUserAndDate(input.userId, input.localDate);
    if (dailyStat === null) {
      throw new FlashcardReviewError(
        'Daily review stat not found for this date',
        FlashcardReviewErrorCode.DAILY_STAT_NOT_FOUND,
      );
    }

    // 5. Bloqueo de la tarjeta + validación de mazo
    const flashcard = await flashcardsRepo.findByIdForUpdate(
      input.flashcardId,
      input.userId,
      manager,
    );
    if (flashcard === null) {
      throw new FlashcardReviewError(
        'Flashcard not found',
        FlashcardReviewErrorCode.FLASHCARD_NOT_FOUND,
      );
    }
    if (flashcard.status === FlashcardStatus.SUSPENDED) {
      throw new FlashcardReviewError(
        'Flashcard is suspended',
        FlashcardReviewErrorCode.FLASHCARD_SUSPENDED,
      );
    }

    const deck = await decksRepo.findActiveByIdAndUser(flashcard.deck_id, input.userId);
    if (deck === null || deck.is_archived) {
      throw new FlashcardReviewError(
        'Deck is archived or no longer available',
        FlashcardReviewErrorCode.DECK_UNAVAILABLE,
      );
    }

    // 6. Conversión numeric → number
    const easeFactor = Number(flashcard.ease_factor);
    if (!Number.isFinite(easeFactor)) {
      throw new FlashcardReviewError(
        'Stored ease factor is not a valid number',
        FlashcardReviewErrorCode.INVALID_EASE_FACTOR,
      );
    }

    // 7. Scheduler
    const currentState: FlashcardSchedulingState = {
      status: flashcard.status,
      intervalMinutes: flashcard.interval_minutes,
      easeFactor,
      repetitions: flashcard.repetitions,
      lapses: flashcard.lapses,
    };
    const schedulingResult = this.schedulingStrategy.calculate(
      currentState,
      input.rating,
      input.reviewedAt,
    );

    const alreadyReviewedToday = await reviewsRepo.existsForFlashcardOnDate(
      input.userId,
      input.flashcardId,
      input.dayStartedAt,
      input.dayEndedAt,
    );

    // 8. Historial inmutable
    const review = await reviewsRepo.createReview({
      userId: input.userId,
      flashcardId: input.flashcardId,
      studySessionId: input.studySessionId,
      idempotencyKey: input.idempotencyKey,
      rating: input.rating,
      previousStatus: currentState.status,
      newStatus: schedulingResult.status,
      previousNextReviewAt: flashcard.next_review_at,
      newNextReviewAt: schedulingResult.nextReviewAt,
      previousIntervalMinutes: currentState.intervalMinutes,
      newIntervalMinutes: schedulingResult.intervalMinutes,
      previousEaseFactor: currentState.easeFactor,
      newEaseFactor: schedulingResult.easeFactor,
      previousRepetitions: currentState.repetitions,
      newRepetitions: schedulingResult.repetitions,
      previousLapses: currentState.lapses,
      newLapses: schedulingResult.lapses,
      responseTimeMs: input.responseTimeMs ?? null,
      reviewedAt: input.reviewedAt,
    });

    // 9. Actualizar scheduling de la tarjeta
    const schedulingUpdate = await flashcardsRepo.updateSchedulingState(
      input.flashcardId,
      input.userId,
      {
        status: schedulingResult.status,
        next_review_at: schedulingResult.nextReviewAt,
        interval_minutes: schedulingResult.intervalMinutes,
        ease_factor: schedulingResult.easeFactor,
        repetitions: schedulingResult.repetitions,
        lapses: schedulingResult.lapses,
      },
    );
    if (schedulingUpdate.affected !== 1) {
      throw new FlashcardReviewError(
        'Flashcard scheduling update affected an unexpected number of rows',
        FlashcardReviewErrorCode.CONCURRENT_UPDATE_CONFLICT,
      );
    }

    // 10. Progreso diario
    await statsRepo.incrementCounters(input.userId, input.localDate, {
      cardsReviewed: 1,
      uniqueCardsReviewed: alreadyReviewedToday ? 0 : 1,
      minutesStudied: 0,
    });

    let updatedStat = await statsRepo.findByUserAndDate(input.userId, input.localDate);
    if (updatedStat === null) {
      throw new Error('DailyReviewStat disappeared mid-transaction');
    }

    // 11. Meta diaria (sin calcular racha)
    if (
      !updatedStat.goal_completed &&
      updatedStat.unique_cards_reviewed >= Math.max(updatedStat.required_reviews, 1)
    ) {
      await statsRepo.markGoalCompleted(input.userId, input.localDate);
      updatedStat = await statsRepo.findByUserAndDate(input.userId, input.localDate);
      if (updatedStat === null) {
        throw new Error('DailyReviewStat disappeared mid-transaction');
      }
    }

    // 12. Sesión — solo lo que tiene semántica correcta aquí: duración transcurrida.
    // No se toca `ended_at` (significa "cierre formal", y la sesión sigue activa) ni
    // `status` (nunca se completa desde este flujo).
    if (session.started_at !== null) {
      const durationMinutes = Math.max(
        0,
        Math.round((input.reviewedAt.getTime() - session.started_at.getTime()) / 60_000),
      );
      const sessionUpdate = await sessionsRepo.updateSessionProgress(
        input.studySessionId,
        input.userId,
        {
          duration_minutes: durationMinutes,
        },
      );
      if (sessionUpdate.affected !== 1) {
        throw new FlashcardReviewError(
          'Study session update affected an unexpected number of rows',
          FlashcardReviewErrorCode.CONCURRENT_UPDATE_CONFLICT,
        );
      }
    }

    const reviewsCount = await reviewsRepo.countBySession(input.studySessionId, input.userId);

    return {
      reviewId: review.id,
      idempotentReplay: false,
      scheduling: {
        previousStatus: currentState.status,
        newStatus: schedulingResult.status,
        previousNextReviewAt: flashcard.next_review_at,
        newNextReviewAt: schedulingResult.nextReviewAt,
        previousIntervalMinutes: currentState.intervalMinutes,
        newIntervalMinutes: schedulingResult.intervalMinutes,
        previousEaseFactor: currentState.easeFactor,
        newEaseFactor: schedulingResult.easeFactor,
        previousRepetitions: currentState.repetitions,
        newRepetitions: schedulingResult.repetitions,
        previousLapses: currentState.lapses,
        newLapses: schedulingResult.lapses,
      },
      dailyProgress: {
        cardsReviewed: updatedStat.cards_reviewed,
        uniqueCardsReviewed: updatedStat.unique_cards_reviewed,
        requiredReviews: updatedStat.required_reviews,
        goalCompleted: updatedStat.goal_completed,
      },
      sessionProgress: { reviewsCount },
    };
  }

  /**
   * Reconstruye el resultado a partir del review ya existente y consultas de
   * progreso actuales — sin crear ningún efecto secundario. Se usa tanto cuando
   * la idempotencia se detecta al inicio (misma transacción) como cuando se
   * detecta por la violación de la unique constraint (fuera de la transacción
   * abortada, con un manager/DataSource nuevo).
   */
  private async buildReplayResult(
    source: RepositorySource,
    input: AnswerFlashcardInput,
  ): Promise<AnswerFlashcardResult> {
    const reviewsRepo = this.deps.flashcardReviews(source);
    const statsRepo = this.deps.dailyReviewStats(source);

    const review = await reviewsRepo.findByIdempotencyKey(input.userId, input.idempotencyKey);
    if (review === null) {
      throw new Error('Idempotency conflict detected but no matching review could be found');
    }

    const stat = await statsRepo.findByUserAndDate(input.userId, input.localDate);
    if (stat === null) {
      throw new Error('DailyReviewStat not found while reconstructing an idempotent replay');
    }

    const reviewsCount = await reviewsRepo.countBySession(input.studySessionId, input.userId);

    return {
      reviewId: review.id,
      idempotentReplay: true,
      scheduling: {
        previousStatus: review.previous_status,
        newStatus: review.new_status,
        previousNextReviewAt: review.previous_next_review_at,
        newNextReviewAt: review.new_next_review_at,
        previousIntervalMinutes: review.previous_interval_minutes,
        newIntervalMinutes: review.new_interval_minutes,
        previousEaseFactor: Number(review.previous_ease_factor),
        newEaseFactor: Number(review.new_ease_factor),
        previousRepetitions: review.previous_repetitions,
        newRepetitions: review.new_repetitions,
        previousLapses: review.previous_lapses,
        newLapses: review.new_lapses,
      },
      dailyProgress: {
        cardsReviewed: stat.cards_reviewed,
        uniqueCardsReviewed: stat.unique_cards_reviewed,
        requiredReviews: stat.required_reviews,
        goalCompleted: stat.goal_completed,
      },
      sessionProgress: { reviewsCount },
    };
  }
}

export { FlashcardReviewService };
export type {
  FlashcardsRepositoryPort,
  FlashcardReviewsRepositoryPort,
  DailyReviewStatsRepositoryPort,
  DecksRepositoryPort,
  StudySessionsRepositoryPort,
  FlashcardReviewServiceDeps,
};
