import { getDatabaseConnection } from '@lib/shared/database';
import { RecommendationsRepository } from '@repositories/recommendations/recommendations.repository';
import {
  classifySkill,
  toSafeRecommendation,
  RULE_SOURCE,
} from '@lib/recommendations/recommendations-library';
import { RecommendationStatus } from '../../models/enums';
import type {
  RecommendationFilters,
  UpdateRecommendationBody,
  SafeRecommendation,
  GenerateResult,
} from '../../interfaces/recommendations/recommendations.interface';

function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const VALID_STATUSES = new Set<string>(Object.values(RecommendationStatus));
const LOOKBACK_DAYS = 30;

class RecommendationsService {
  async getRecommendations(
    userId: string,
    filters: RecommendationFilters,
  ): Promise<{ data: SafeRecommendation[]; total: number; limit: number; offset: number }> {
    if (filters.status !== undefined && !VALID_STATUSES.has(filters.status)) {
      throw createError(`status must be one of: ${[...VALID_STATUSES].join(', ')}`, 400);
    }

    const limit = Math.min(filters.limit ?? 20, 100);
    const offset = filters.offset ?? 0;

    const ds = await getDatabaseConnection();
    const repo = new RecommendationsRepository(ds);

    const [recs, total] = await repo.findByUser(userId, {
      status: filters.status,
      type: filters.type,
      limit,
      offset,
    });

    return { data: recs.map(toSafeRecommendation), total, limit, offset };
  }

  async generateRecommendations(userId: string): Promise<GenerateResult> {
    const ds = await getDatabaseConnection();
    const repo = new RecommendationsRepository(ds);

    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const skillAverages = await repo.getSkillAverages(userId, since);

    if (skillAverages.length === 0) {
      return { created: 0, updated: 0, recommendations: [] };
    }

    let created = 0;
    let updated = 0;
    const results: SafeRecommendation[] = [];

    for (const { skillId, skillName, avgScore } of skillAverages) {
      const classification = classifySkill(skillName, avgScore);

      const existing = await repo.findPendingForSkill(userId, skillId);

      if (existing !== null) {
        await repo.updateFields(existing.id, {
          title: classification.title,
          description: classification.description,
          recommendation_type: classification.recommendationType,
          priority: classification.priority,
        });
        const refreshed = await repo.findById(existing.id);
        if (refreshed !== null) {
          results.push(toSafeRecommendation(refreshed));
        }
        updated++;
      } else {
        const rec = await repo.create({
          userId,
          skillId,
          title: classification.title,
          description: classification.description,
          recommendationType: classification.recommendationType,
          priority: classification.priority,
          source: RULE_SOURCE,
        });
        const withSkill = await repo.findById(rec.id);
        if (withSkill !== null) {
          results.push(toSafeRecommendation(withSkill));
        }
        created++;
      }
    }

    return { created, updated, recommendations: results };
  }

  async updateRecommendation(
    userId: string,
    recommendationId: string,
    body: UpdateRecommendationBody,
  ): Promise<SafeRecommendation> {
    if (!body.status) {
      throw createError('status is required', 400);
    }
    if (!VALID_STATUSES.has(body.status)) {
      throw createError(`status must be one of: ${[...VALID_STATUSES].join(', ')}`, 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new RecommendationsRepository(ds);

    const existing = await repo.findById(recommendationId);
    if (existing === null || existing.user_id !== userId) {
      throw createError('Recommendation not found', 404);
    }

    await repo.updateFields(recommendationId, {
      status: body.status as RecommendationStatus,
    });

    const updated = await repo.findById(recommendationId);
    if (updated === null) throw createError('Recommendation not found', 500);

    return toSafeRecommendation(updated);
  }

  async deleteRecommendation(userId: string, recommendationId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new RecommendationsRepository(ds);

    const existing = await repo.findById(recommendationId);
    if (existing === null || existing.user_id !== userId) {
      throw createError('Recommendation not found', 404);
    }

    await repo.softDelete(recommendationId);
  }
}

export { RecommendationsService };
