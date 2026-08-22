import type { DataSource } from 'typeorm';
import {
  PracticeRecommendation,
  PracticeRecommendationStatus,
} from '@models/PracticeRecommendation';
import type {
  PracticeLocale,
  PracticeInsights,
  PracticeRecommendation as RecommendationDto,
} from '../../interfaces/practice/practice-adaptive.interface';
const STALE_PENDING_MS = 2 * 60 * 1000;

export class PracticeRecommendationsRepository {
  private readonly repo;
  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(PracticeRecommendation);
  }
  findReady(userId: string, hash: string, locale: PracticeLocale, version: string) {
    return this.repo.findOne({
      where: {
        user_id: userId,
        snapshot_hash: hash,
        locale,
        prompt_version: version,
        status: PracticeRecommendationStatus.READY,
      },
    });
  }
  /**
   * Atomically claims the (user, snapshot, locale, version) slot as pending:
   * inserts it if absent, or reclaims it if the existing row is failed or a
   * stale abandoned pending (e.g. a Lambda invocation killed mid-flight).
   * Returns null when an active ready/pending row already owns the slot.
   */
  async claimPending(
    userId: string,
    hash: string,
    locale: PracticeLocale,
    version: string,
    insights: PracticeInsights,
  ): Promise<PracticeRecommendation | null> {
    const staleBefore = new Date(Date.now() - STALE_PENDING_MS);
    const rows = await this.repo.query(
      `INSERT INTO practice_recommendations
         (user_id, snapshot_hash, locale, prompt_version, status, insights_snapshot, recommendation)
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, NULL)
       ON CONFLICT (user_id, snapshot_hash, locale, prompt_version)
       DO UPDATE SET status = 'pending',
                      insights_snapshot = EXCLUDED.insights_snapshot,
                      recommendation = NULL,
                      updated_at = now()
       WHERE practice_recommendations.status = 'failed'
          OR (practice_recommendations.status = 'pending' AND practice_recommendations.updated_at < $6)
       RETURNING *`,
      [userId, hash, locale, version, JSON.stringify(insights), staleBefore],
    );
    return rows[0] ? this.repo.create(rows[0]) : null;
  }
  async markReady(id: string, recommendation: RecommendationDto) {
    await this.repo.update({ id }, { status: PracticeRecommendationStatus.READY, recommendation });
  }
  async markFailed(id: string) {
    await this.repo.update({ id }, { status: PracticeRecommendationStatus.FAILED });
  }
}
