import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { FlashcardPreference } from '@models/FlashcardPreference';

const DEFAULT_DAILY_GOAL = 10;

class FlashcardPreferencesRepository {
  private readonly preferenceRepo: Repository<FlashcardPreference>;

  constructor(dataSource: DataSource | EntityManager) {
    this.preferenceRepo = dataSource.getRepository(FlashcardPreference);
  }

  async findByUser(userId: string): Promise<FlashcardPreference | null> {
    return this.preferenceRepo.findOne({ where: { user_id: userId } });
  }

  /**
   * Inserta las preferencias por defecto. Usa ON CONFLICT DO NOTHING sobre la
   * unique (user_id): si dos requests intentan crearlas al mismo tiempo, solo
   * una tiene efecto y la unique de user_id queda como la protección final.
   */
  async createDefault(userId: string): Promise<void> {
    await this.preferenceRepo
      .createQueryBuilder()
      .insert()
      .into(FlashcardPreference)
      .values({ user_id: userId, daily_goal: DEFAULT_DAILY_GOAL })
      .orIgnore()
      .execute();
  }

  async getOrCreate(userId: string): Promise<FlashcardPreference> {
    const existing = await this.findByUser(userId);
    if (existing !== null) return existing;

    await this.createDefault(userId);

    const created = await this.findByUser(userId);
    if (created === null) {
      throw new Error('FlashcardPreference not found after getOrCreate');
    }
    return created;
  }

  async updateDailyGoal(userId: string, dailyGoal: number): Promise<UpdateResult> {
    return this.preferenceRepo.update({ user_id: userId }, { daily_goal: dailyGoal });
  }
}

export { FlashcardPreferencesRepository };
