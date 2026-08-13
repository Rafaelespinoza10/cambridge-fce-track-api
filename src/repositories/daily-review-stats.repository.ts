import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { DailyReviewStat } from '../models/DailyReviewStat';

interface CreateDailyReviewStatData {
  userId: string;
  localDate: string;
  timezone: string;
  dailyGoal: number;
  cardsDueAtFirstSession: number;
  requiredReviews: number;
}

interface IncrementDailyReviewStatData {
  cardsReviewed: number;
  uniqueCardsReviewed: number;
  minutesStudied: number;
}

interface DateRange {
  from: string;
  to: string;
}

class DailyReviewStatsRepository {
  private readonly statRepo: Repository<DailyReviewStat>;

  constructor(dataSource: DataSource | EntityManager) {
    this.statRepo = dataSource.getRepository(DailyReviewStat);
  }

  async findByUserAndDate(userId: string, localDate: string): Promise<DailyReviewStat | null> {
    return this.statRepo.findOne({ where: { user_id: userId, local_date: localDate } });
  }

  /**
   * Inserta la fila del día con sus snapshots. Usa ON CONFLICT DO NOTHING sobre
   * la unique (user_id, local_date) para que una carrera entre dos requests que
   * intentan crear el primer registro del día no falle ni sobrescriba snapshots
   * — el que pierde la carrera simplemente no hace nada. El caller debe volver a
   * leer con findByUserAndDate para obtener la fila definitiva.
   */
  async createDailyStat(data: CreateDailyReviewStatData): Promise<void> {
    await this.statRepo
      .createQueryBuilder()
      .insert()
      .into(DailyReviewStat)
      .values({
        user_id: data.userId,
        local_date: data.localDate,
        timezone: data.timezone,
        daily_goal: data.dailyGoal,
        cards_due_at_first_session: data.cardsDueAtFirstSession,
        required_reviews: data.requiredReviews,
      })
      .orIgnore()
      .execute();
  }

  /**
   * Incremento atómico vía expresión SQL (columna = columna + delta), evitando
   * el patrón inseguro de leer-incrementar en memoria-guardar. No toca los
   * campos snapshot (timezone, daily_goal, cards_due_at_first_session,
   * required_reviews), que solo se establecen en createDailyStat.
   */
  async incrementCounters(
    userId: string,
    localDate: string,
    delta: IncrementDailyReviewStatData,
  ): Promise<UpdateResult> {
    return this.statRepo
      .createQueryBuilder()
      .update(DailyReviewStat)
      .set({
        cards_reviewed: () => '"cards_reviewed" + :cardsReviewedDelta',
        unique_cards_reviewed: () => '"unique_cards_reviewed" + :uniqueCardsReviewedDelta',
        minutes_studied: () => '"minutes_studied" + :minutesStudiedDelta',
      })
      .where('user_id = :userId', { userId })
      .andWhere('local_date = :localDate', { localDate })
      .setParameters({
        cardsReviewedDelta: delta.cardsReviewed,
        uniqueCardsReviewedDelta: delta.uniqueCardsReviewed,
        minutesStudiedDelta: delta.minutesStudied,
      })
      .execute();
  }

  async markGoalCompleted(userId: string, localDate: string): Promise<UpdateResult> {
    return this.statRepo.update(
      { user_id: userId, local_date: localDate },
      { goal_completed: true },
    );
  }

  async findCompletedDates(userId: string, range: Partial<DateRange> = {}): Promise<string[]> {
    const qb = this.statRepo
      .createQueryBuilder('stat')
      .select('stat.local_date::text', 'local_date')
      .where('stat.user_id = :userId', { userId })
      .andWhere('stat.goal_completed = true');

    if (range.from !== undefined) qb.andWhere('stat.local_date >= :from', { from: range.from });
    if (range.to !== undefined) qb.andWhere('stat.local_date <= :to', { to: range.to });

    qb.orderBy('stat.local_date', 'DESC');

    const rows = await qb.getRawMany<{ local_date: string | Date }>();

    // PostgreSQL/TypeORM puede hidratar una columna DATE como Date. El cálculo
    // de racha trabaja con fechas locales en formato YYYY-MM-DD, no con
    // instantes UTC; el cast a texto conserva exactamente la fecha almacenada.
    return rows.map((r) =>
      r.local_date instanceof Date
        ? r.local_date.toISOString().slice(0, 10)
        : String(r.local_date).slice(0, 10),
    );
  }

  async findByUserAndDateRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<DailyReviewStat[]> {
    return this.statRepo
      .createQueryBuilder('stat')
      .where('stat.user_id = :userId', { userId })
      .andWhere('stat.local_date >= :from', { from })
      .andWhere('stat.local_date <= :to', { to })
      .orderBy('stat.local_date', 'DESC')
      .getMany();
  }
}

export { DailyReviewStatsRepository };
export type { CreateDailyReviewStatData, IncrementDailyReviewStatData };
