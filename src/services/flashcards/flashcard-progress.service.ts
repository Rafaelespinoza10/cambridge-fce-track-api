import type { DataSource, EntityManager, UpdateResult } from 'typeorm';

import { UsersRepository } from '@repositories/users/users.repository';
import { FlashcardPreferencesRepository } from '@repositories/flashcards/flashcard-preferences.repository';
import { DailyReviewStatsRepository } from '@repositories/flashcards/daily-review-stats.repository';
import { FlashcardsRepository } from '@repositories/flashcards/flashcards.repository';

import { resolveLocalDay, isValidTimeZone } from '@lib/shared/timezone';
import { calculateFlashcardStreak } from '@lib/flashcards/flashcard-streak';

import type { User } from '../../models/User';
import type { FlashcardPreference } from '../../models/FlashcardPreference';
import type { DailyReviewStat } from '../../models/DailyReviewStat';
import type {
  FlashcardPreferencesDto,
  UpdateFlashcardPreferencesRequest,
  FlashcardReviewSummaryDto,
} from '../../interfaces/flashcards/flashcard-progress.interface';

function addCalendarDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function buildReviewWeek(localDate: string, completedDates: string[]) {
  const completed = new Set(completedDates);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addCalendarDays(localDate, index - 6);
    return { date, completed: completed.has(date) };
  });
}

export enum FlashcardProgressErrorCode {
  INVALID_INPUT = 'invalid_input',
  USER_NOT_FOUND = 'user_not_found',
  PROFILE_NOT_FOUND = 'profile_not_found',
  INVALID_TIMEZONE = 'invalid_timezone',
  PREFERENCES_UPDATE_CONFLICT = 'preferences_update_conflict',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class FlashcardProgressError extends Error {
  constructor(
    message: string,
    readonly code: FlashcardProgressErrorCode,
  ) {
    super(message);
    this.name = 'FlashcardProgressError';
  }
}

interface UsersRepositoryPort {
  findUserWithProfile(userId: string): Promise<User | null>;
}

interface FlashcardPreferencesRepositoryPort {
  getOrCreate(userId: string): Promise<FlashcardPreference>;
  findByUser(userId: string): Promise<FlashcardPreference | null>;
  updateDailyGoal(userId: string, dailyGoal: number): Promise<UpdateResult>;
}

interface DailyReviewStatsRepositoryPort {
  findByUserAndDate(userId: string, localDate: string): Promise<DailyReviewStat | null>;
  findCompletedDates(userId: string): Promise<string[]>;
  resyncDailyGoal(userId: string, localDate: string, dailyGoal: number): Promise<UpdateResult>;
  markGoalCompleted(userId: string, localDate: string): Promise<UpdateResult>;
}

interface FlashcardsRepositoryPort {
  countDueByUser(userId: string, asOf: Date): Promise<number>;
}

type RepositorySource = DataSource | EntityManager;

interface FlashcardProgressServiceDeps {
  users: (source: RepositorySource) => UsersRepositoryPort;
  flashcardPreferences: (source: RepositorySource) => FlashcardPreferencesRepositoryPort;
  dailyReviewStats: (source: RepositorySource) => DailyReviewStatsRepositoryPort;
  flashcards: (source: RepositorySource) => FlashcardsRepositoryPort;
}

const DEFAULT_DEPS: FlashcardProgressServiceDeps = {
  users: (source) => new UsersRepository(source),
  flashcardPreferences: (source) => new FlashcardPreferencesRepository(source),
  dailyReviewStats: (source) => new DailyReviewStatsRepository(source),
  flashcards: (source) => new FlashcardsRepository(source),
};

const DEFAULT_TIMEZONE = 'UTC';
const DAILY_GOAL_MAX = 500;

function normalizeDailyGoal(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FlashcardProgressError(
      'dailyGoal must be a number',
      FlashcardProgressErrorCode.INVALID_INPUT,
    );
  }
  if (!Number.isInteger(value)) {
    throw new FlashcardProgressError(
      'dailyGoal must be an integer',
      FlashcardProgressErrorCode.INVALID_INPUT,
    );
  }
  if (value <= 0) {
    throw new FlashcardProgressError(
      'dailyGoal must be greater than zero',
      FlashcardProgressErrorCode.INVALID_INPUT,
    );
  }
  if (value > DAILY_GOAL_MAX) {
    throw new FlashcardProgressError(
      `dailyGoal must be at most ${DAILY_GOAL_MAX}`,
      FlashcardProgressErrorCode.INVALID_INPUT,
    );
  }
  return value;
}

function toPreferencesDto(preference: FlashcardPreference): FlashcardPreferencesDto {
  return { dailyGoal: preference.daily_goal };
}

class FlashcardProgressService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: FlashcardProgressServiceDeps = DEFAULT_DEPS,
  ) {}

  private usersRepo(): UsersRepositoryPort {
    return this.deps.users(this.dataSource);
  }

  private preferencesRepo(): FlashcardPreferencesRepositoryPort {
    return this.deps.flashcardPreferences(this.dataSource);
  }

  private dailyReviewStatsRepo(): DailyReviewStatsRepositoryPort {
    return this.deps.dailyReviewStats(this.dataSource);
  }

  private flashcardsRepo(): FlashcardsRepositoryPort {
    return this.deps.flashcards(this.dataSource);
  }

  /**
   * Resuelve la timezone efectiva del usuario siguiendo la misma regla
   * aprobada que StartFlashcardReviewSessionService: perfil ausente o
   * timezone null -> UTC; timezone IANA inválida -> error de dominio. No
   * reutiliza el servicio de sesión de repaso para evitar acoplar dominios —
   * ambos duplican este bloque pequeño de forma intencional.
   */
  private async resolveUserTimezone(userId: string): Promise<string> {
    const user = await this.usersRepo().findUserWithProfile(userId);
    if (user === null) {
      throw new FlashcardProgressError('User not found', FlashcardProgressErrorCode.USER_NOT_FOUND);
    }
    const profile = user.profile as User['profile'] | null;
    // El resumen también se muestra en la pantalla de mazos, incluso para
    // cuentas antiguas que todavía no tienen fila en user_profiles. UTC es
    // un fallback seguro hasta que el usuario configure su zona horaria.
    if (profile === null || profile === undefined) return DEFAULT_TIMEZONE;

    if (profile.timezone === null) {
      return DEFAULT_TIMEZONE;
    }
    if (!isValidTimeZone(profile.timezone)) {
      throw new FlashcardProgressError(
        `Invalid IANA timezone stored in user profile: ${profile.timezone}`,
        FlashcardProgressErrorCode.INVALID_TIMEZONE,
      );
    }
    return profile.timezone;
  }

  async getPreferences(userId: string): Promise<FlashcardPreferencesDto> {
    const preference = await this.preferencesRepo().getOrCreate(userId);
    return toPreferencesDto(preference);
  }

  async updatePreferences(
    userId: string,
    input: UpdateFlashcardPreferencesRequest,
    now: Date = new Date(),
  ): Promise<FlashcardPreferencesDto> {
    const dailyGoal = normalizeDailyGoal(input.dailyGoal);

    await this.preferencesRepo().getOrCreate(userId);

    const result = await this.preferencesRepo().updateDailyGoal(userId, dailyGoal);
    if (result.affected !== 1) {
      throw new FlashcardProgressError(
        'Preferences update was not applied',
        FlashcardProgressErrorCode.PREFERENCES_UPDATE_CONFLICT,
      );
    }

    const updated = await this.preferencesRepo().findByUser(userId);
    if (updated === null) {
      throw new FlashcardProgressError(
        'Preferences disappeared after update',
        FlashcardProgressErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    await this.resyncTodayGoal(userId, dailyGoal, now);

    return toPreferencesDto(updated);
  }

  /**
   * Un cambio de meta debe reflejarse en el día en curso, no solo desde
   * mañana — si no, el usuario puede completar el nuevo objetivo y el día
   * nunca se marca como cumplido (bug reportado: bajar la meta manualmente
   * era el único workaround). Solo toca la fila si el día ya existe y aún
   * no está completado; un día ya cumplido se preserva como logro histórico.
   */
  private async resyncTodayGoal(userId: string, dailyGoal: number, now: Date): Promise<void> {
    const timezone = await this.resolveUserTimezone(userId);
    const { localDate } = resolveLocalDay(now, timezone);

    const existing = await this.dailyReviewStatsRepo().findByUserAndDate(userId, localDate);
    if (existing === null || existing.goal_completed) return;

    await this.dailyReviewStatsRepo().resyncDailyGoal(userId, localDate, dailyGoal);

    const resynced = await this.dailyReviewStatsRepo().findByUserAndDate(userId, localDate);
    if (
      resynced !== null &&
      !resynced.goal_completed &&
      resynced.unique_cards_reviewed >= Math.max(resynced.required_reviews, 1)
    ) {
      await this.dailyReviewStatsRepo().markGoalCompleted(userId, localDate);
    }
  }

  async getReviewSummary(userId: string, now: Date): Promise<FlashcardReviewSummaryDto> {
    const timezone = await this.resolveUserTimezone(userId);
    const { localDate } = resolveLocalDay(now, timezone);

    const preference = await this.preferencesRepo().getOrCreate(userId);
    const cardsDueNow = await this.flashcardsRepo().countDueByUser(userId, now);
    const dailyStat = await this.dailyReviewStatsRepo().findByUserAndDate(userId, localDate);

    const completedDates = await this.dailyReviewStatsRepo().findCompletedDates(userId);
    const streak = calculateFlashcardStreak(completedDates, localDate);
    const week = buildReviewWeek(localDate, completedDates);

    const day =
      dailyStat === null
        ? {
            initialized: false,
            localDate,
            timezone,
            cardsDueNow,
            dailyGoal: preference.daily_goal,
            cardsDueAtFirstSession: null,
            requiredReviews: null,
            cardsReviewed: 0,
            uniqueCardsReviewed: 0,
            goalCompleted: false,
          }
        : {
            initialized: true,
            localDate: dailyStat.local_date,
            timezone: dailyStat.timezone,
            cardsDueNow,
            dailyGoal: dailyStat.daily_goal,
            cardsDueAtFirstSession: dailyStat.cards_due_at_first_session,
            requiredReviews: dailyStat.required_reviews,
            cardsReviewed: dailyStat.cards_reviewed,
            uniqueCardsReviewed: dailyStat.unique_cards_reviewed,
            goalCompleted: dailyStat.goal_completed,
          };

    return {
      preferences: toPreferencesDto(preference),
      day,
      streak,
      week,
    };
  }
}

export { FlashcardProgressService };
export type {
  UsersRepositoryPort,
  FlashcardPreferencesRepositoryPort,
  DailyReviewStatsRepositoryPort,
  FlashcardsRepositoryPort,
  FlashcardProgressServiceDeps,
};
