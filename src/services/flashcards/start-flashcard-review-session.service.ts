import type { DataSource, EntityManager } from 'typeorm';

import { UsersRepository } from '@repositories/users/users.repository';
import { FlashcardPreferencesRepository } from '@repositories/flashcards/flashcard-preferences.repository';
import { StudySessionsRepository } from '@repositories/flashcards/study-sessions.repository';
import { DailyReviewStatsRepository } from '@repositories/flashcards/daily-review-stats.repository';
import type { CreateDailyReviewStatData } from '@repositories/flashcards/daily-review-stats.repository';
import { DecksRepository } from '@repositories/decks/decks.repository';
import { FlashcardsRepository } from '@repositories/flashcards/flashcards.repository';
import type {
  FindDueOptions,
  CountDueOptions,
} from '@repositories/flashcards/flashcards.repository';

import { resolveLocalDay, isValidTimeZone } from '@lib/flashcards/timezone';

import type { User } from '../../models/User';
import type { Deck } from '../../models/Deck';
import type { Flashcard } from '../../models/Flashcard';
import type { StudySession } from '../../models/StudySession';
import type { DailyReviewStat } from '../../models/DailyReviewStat';
import type { FlashcardPreference } from '../../models/FlashcardPreference';
import type {
  StartFlashcardReviewSessionInput,
  StartFlashcardReviewSessionResult,
  FlashcardQueueItem,
} from '../../interfaces/flashcards/start-flashcard-review-session.interface';

export enum StartFlashcardReviewSessionErrorCode {
  INVALID_INPUT = 'invalid_input',
  USER_NOT_FOUND = 'user_not_found',
  PROFILE_NOT_FOUND = 'profile_not_found',
  INVALID_TIMEZONE = 'invalid_timezone',
  DECK_UNAVAILABLE = 'deck_unavailable',
  SESSION_RACE_UNRESOLVED = 'session_race_unresolved',
}

export class StartFlashcardReviewSessionError extends Error {
  constructor(
    message: string,
    readonly code: StartFlashcardReviewSessionErrorCode,
  ) {
    super(message);
    this.name = 'StartFlashcardReviewSessionError';
  }
}

interface UsersRepositoryPort {
  findUserWithProfile(userId: string): Promise<User | null>;
}

interface FlashcardPreferencesRepositoryPort {
  getOrCreate(userId: string): Promise<FlashcardPreference>;
}

interface StudySessionsRepositoryPort {
  findActiveFlashcardSessionByUser(userId: string): Promise<StudySession | null>;
  createFlashcardSession(userId: string, startedAt: Date): Promise<StudySession>;
}

interface DailyReviewStatsRepositoryPort {
  findByUserAndDate(userId: string, localDate: string): Promise<DailyReviewStat | null>;
  createDailyStat(data: CreateDailyReviewStatData): Promise<void>;
}

interface DecksRepositoryPort {
  findActiveByIdAndUser(deckId: string, userId: string): Promise<Deck | null>;
}

interface FlashcardsRepositoryPort {
  findDueByUser(userId: string, asOf: Date, options?: FindDueOptions): Promise<Flashcard[]>;
  countDueByUser(userId: string, asOf: Date, options?: CountDueOptions): Promise<number>;
}

type RepositorySource = DataSource | EntityManager;

interface StartFlashcardReviewSessionServiceDeps {
  users: (source: RepositorySource) => UsersRepositoryPort;
  flashcardPreferences: (source: RepositorySource) => FlashcardPreferencesRepositoryPort;
  studySessions: (source: RepositorySource) => StudySessionsRepositoryPort;
  dailyReviewStats: (source: RepositorySource) => DailyReviewStatsRepositoryPort;
  decks: (source: RepositorySource) => DecksRepositoryPort;
  flashcards: (source: RepositorySource) => FlashcardsRepositoryPort;
}

const DEFAULT_DEPS: StartFlashcardReviewSessionServiceDeps = {
  users: (source) => new UsersRepository(source),
  flashcardPreferences: (source) => new FlashcardPreferencesRepository(source),
  studySessions: (source) => new StudySessionsRepository(source),
  dailyReviewStats: (source) => new DailyReviewStatsRepository(source),
  decks: (source) => new DecksRepository(source),
  flashcards: (source) => new FlashcardsRepository(source),
};

const DEFAULT_TIMEZONE = 'UTC';
const MAX_RACE_RETRIES = 1;
const ACTIVE_SESSION_CONSTRAINT_NAME = 'uq_study_sessions_one_active_flashcard_review';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function validateInput(input: StartFlashcardReviewSessionInput): void {
  if (!isNonEmptyString(input.userId)) {
    throw new StartFlashcardReviewSessionError(
      'userId is required',
      StartFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  }
  if (!isValidDate(input.requestedAt)) {
    throw new StartFlashcardReviewSessionError(
      'requestedAt must be a valid Date',
      StartFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  }
  if (input.deckId !== undefined && !isNonEmptyString(input.deckId)) {
    throw new StartFlashcardReviewSessionError(
      'deckId, when provided, must be a non-empty string',
      StartFlashcardReviewSessionErrorCode.INVALID_INPUT,
    );
  }
}

function isActiveSessionConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === ACTIVE_SESSION_CONSTRAINT_NAME;
}

function mapFlashcardToQueueItem(flashcard: Flashcard): FlashcardQueueItem {
  return {
    id: flashcard.id,
    deckId: flashcard.deck_id,
    type: flashcard.type,
    front: flashcard.front,
    back: flashcard.back,
    translation: flashcard.translation,
    example: flashcard.example,
    personalExample: flashcard.personal_example,
    notes: flashcard.notes,
    level: flashcard.level,
    tags: flashcard.tags,
    status: flashcard.status,
    nextReviewAt: flashcard.next_review_at,
  };
}

class StartFlashcardReviewSessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: StartFlashcardReviewSessionServiceDeps = DEFAULT_DEPS,
  ) {}

  async execute(
    input: StartFlashcardReviewSessionInput,
  ): Promise<StartFlashcardReviewSessionResult> {
    validateInput(input);
    return this.executeWithRetry(input, 0);
  }

  /**
   * La creación de StudySession no usa ON CONFLICT DO NOTHING (a diferencia de
   * FlashcardPreference/DailyReviewStat): una carrera real entre dos requests
   * concurrentes viola `uq_study_sessions_one_active_flashcard_review` y aborta
   * la transacción. En ese caso, un reintento acotado (una sola vez) de todo el
   * flujo es correcto y más simple que reconstruir el resultado a mano — el
   * segundo intento encuentra la sesión ya creada por el ganador de la carrera
   * y toma naturalmente la ruta de "retomar sesión existente".
   */
  private async executeWithRetry(
    input: StartFlashcardReviewSessionInput,
    attempt: number,
  ): Promise<StartFlashcardReviewSessionResult> {
    try {
      return await this.dataSource.transaction((manager) => this.runInTransaction(manager, input));
    } catch (error) {
      if (isActiveSessionConstraintViolation(error)) {
        if (attempt < MAX_RACE_RETRIES) {
          return this.executeWithRetry(input, attempt + 1);
        }
        throw new StartFlashcardReviewSessionError(
          'Could not resolve the active flashcard review session after a race retry',
          StartFlashcardReviewSessionErrorCode.SESSION_RACE_UNRESOLVED,
        );
      }
      throw error;
    }
  }

  private async runInTransaction(
    manager: EntityManager,
    input: StartFlashcardReviewSessionInput,
  ): Promise<StartFlashcardReviewSessionResult> {
    const usersRepo = this.deps.users(manager);
    const preferencesRepo = this.deps.flashcardPreferences(manager);
    const sessionsRepo = this.deps.studySessions(manager);
    const statsRepo = this.deps.dailyReviewStats(manager);
    const decksRepo = this.deps.decks(manager);
    const flashcardsRepo = this.deps.flashcards(manager);

    // 1. Usuario, perfil y timezone
    const user = await usersRepo.findUserWithProfile(input.userId);
    if (user === null) {
      throw new StartFlashcardReviewSessionError(
        'User not found',
        StartFlashcardReviewSessionErrorCode.USER_NOT_FOUND,
      );
    }
    const profile = user.profile as User['profile'] | null;
    if (profile === null || profile === undefined) {
      throw new StartFlashcardReviewSessionError(
        'User profile not found',
        StartFlashcardReviewSessionErrorCode.PROFILE_NOT_FOUND,
      );
    }

    let timezone = DEFAULT_TIMEZONE;
    if (profile.timezone !== null) {
      if (!isValidTimeZone(profile.timezone)) {
        throw new StartFlashcardReviewSessionError(
          `Invalid IANA timezone stored in user profile: ${profile.timezone}`,
          StartFlashcardReviewSessionErrorCode.INVALID_TIMEZONE,
        );
      }
      timezone = profile.timezone;
    }

    const localDay = resolveLocalDay(input.requestedAt, timezone);

    // 2. Validación opcional de mazo
    if (input.deckId !== undefined) {
      const deck = await decksRepo.findActiveByIdAndUser(input.deckId, input.userId);
      if (deck === null || deck.is_archived) {
        throw new StartFlashcardReviewSessionError(
          'Deck not found, deleted or archived',
          StartFlashcardReviewSessionErrorCode.DECK_UNAVAILABLE,
        );
      }
    }

    // 3. Preferencias — get-or-create
    const preferences = await preferencesRepo.getOrCreate(input.userId);

    // 4. Sesión activa de flashcard_review — get-or-create (nunca reinicia started_at)
    let session = await sessionsRepo.findActiveFlashcardSessionByUser(input.userId);
    let sessionResumed = true;
    if (session === null) {
      sessionResumed = false;
      session = await sessionsRepo.createFlashcardSession(input.userId, input.requestedAt);
    }

    // 5. DailyReviewStat del día local — get-or-create con snapshots inmutables.
    // cardsDueAtFirstSession/requiredReviews se calculan SOLO al crear la fila,
    // con el mismo alcance de deckId que la cola de esta sesión — si la primera
    // sesión del día es dentro de un mazo, la meta nunca exige más tarjetas de
    // las que ese mazo puede llegar a ofrecer. Sin deckId, sigue siendo la
    // cuenta completa.
    let dailyStat = await statsRepo.findByUserAndDate(input.userId, localDay.localDate);
    if (dailyStat === null) {
      const dueCountOptions: CountDueOptions = {};
      if (input.deckId !== undefined) dueCountOptions.deckId = input.deckId;
      const cardsDueAtFirstSession = await flashcardsRepo.countDueByUser(
        input.userId,
        input.requestedAt,
        dueCountOptions,
      );
      const requiredReviews = Math.min(preferences.daily_goal, cardsDueAtFirstSession);
      await statsRepo.createDailyStat({
        userId: input.userId,
        localDate: localDay.localDate,
        timezone,
        dailyGoal: preferences.daily_goal,
        cardsDueAtFirstSession,
        requiredReviews,
      });
      dailyStat = await statsRepo.findByUserAndDate(input.userId, localDay.localDate);
      if (dailyStat === null) {
        throw new Error('DailyReviewStat disappeared mid-transaction');
      }
    }

    // 6. Cola de tarjetas pendientes — respeta deckId si se especificó. Una cola
    // vacía es un estado válido (nada pendiente ahora mismo), no un error.
    const queueOptions: FindDueOptions = {};
    if (input.deckId !== undefined) queueOptions.deckId = input.deckId;
    const dueCards = await flashcardsRepo.findDueByUser(
      input.userId,
      input.requestedAt,
      queueOptions,
    );

    return {
      studySessionId: session.id,
      sessionResumed,
      sessionStartedAt: session.started_at ?? input.requestedAt,
      timezone,
      localDate: localDay.localDate,
      dayStartedAt: localDay.dayStartedAt,
      dayEndedAt: localDay.dayEndedAt,
      dailyGoal: preferences.daily_goal,
      dailyProgress: {
        cardsReviewed: dailyStat.cards_reviewed,
        uniqueCardsReviewed: dailyStat.unique_cards_reviewed,
        requiredReviews: dailyStat.required_reviews,
        cardsDueAtFirstSession: dailyStat.cards_due_at_first_session,
        goalCompleted: dailyStat.goal_completed,
      },
      queue: {
        cards: dueCards.map(mapFlashcardToQueueItem),
        cardsDue: dueCards.length,
      },
    };
  }
}

export { StartFlashcardReviewSessionService };
export type {
  UsersRepositoryPort,
  FlashcardPreferencesRepositoryPort,
  StudySessionsRepositoryPort,
  DailyReviewStatsRepositoryPort,
  DecksRepositoryPort,
  FlashcardsRepositoryPort,
  StartFlashcardReviewSessionServiceDeps,
};
