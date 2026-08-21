import { createHash } from 'node:crypto';
import { isPracticeGenerationSupported } from '@lib/practice/practice-exam-catalog';
import type {
  PracticeInsights,
  PracticeLocale,
  PracticeRecommendation,
} from '../../interfaces/practice/practice-adaptive.interface';
import type { PracticeRecommendationsRepository } from '@repositories/practice/practice-recommendations.repository';
import { GetPracticeInsightsService } from './get-practice-insights.service';
import type {
  PracticeCandidate,
  PracticeRecommendationGenerator,
} from './practice-recommendation-generator';
export const PRACTICE_RECOMMENDATION_PROMPT_VERSION = 'practice-adaptive-recommendation-v1';
export enum PracticeRecommendationErrorCode {
  INVALID_INPUT = 'INVALID_INPUT',
  RECOMMENDATION_IN_PROGRESS = 'RECOMMENDATION_IN_PROGRESS',
  AI_RATE_LIMITED = 'AI_RATE_LIMITED',
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  AI_PROVIDER_UNAVAILABLE = 'AI_PROVIDER_UNAVAILABLE',
  AI_REQUEST_TIMEOUT = 'AI_REQUEST_TIMEOUT',
  AI_CONFIGURATION_ERROR = 'AI_CONFIGURATION_ERROR',
  PERSISTENCE_INCONSISTENCY = 'PERSISTENCE_INCONSISTENCY',
}
export class PracticeRecommendationError extends Error {
  constructor(readonly code: PracticeRecommendationErrorCode) {
    super(code);
    this.name = 'PracticeRecommendationError';
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value as object)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as any)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function practiceInsightsSnapshotHash(insights: PracticeInsights): string {
  return createHash('sha256').update(canonical(insights)).digest('hex');
}
export class GeneratePracticeRecommendationService {
  constructor(
    private readonly insightsService: GetPracticeInsightsService,
    private readonly repository: Pick<
      PracticeRecommendationsRepository,
      'findReady' | 'claimPending' | 'markReady' | 'markFailed'
    >,
    private readonly generator: PracticeRecommendationGenerator,
  ) {}
  async execute(
    userId: string,
    locale: PracticeLocale,
  ): Promise<{
    status: 'ready' | 'insufficient_data';
    insights: PracticeInsights;
    recommendation: PracticeRecommendation | null;
  }> {
    if (locale !== 'en' && locale !== 'es')
      throw new PracticeRecommendationError(PracticeRecommendationErrorCode.INVALID_INPUT);
    const insights = await this.insightsService.execute(userId);
    if (!insights.eligibleForRecommendation)
      return { status: 'insufficient_data', insights, recommendation: null };
    const candidates: PracticeCandidate[] = insights.byPart
      .filter(
        (p) =>
          p.itemCount > 0 && isPracticeGenerationSupported(p.examCode, p.paperCode, p.partCode),
      )
      .map((p) => ({ examCode: p.examCode, paperCode: p.paperCode, partCode: p.partCode }));
    if (!candidates.length) return { status: 'insufficient_data', insights, recommendation: null };
    const hash = practiceInsightsSnapshotHash(insights);
    const ready = await this.repository.findReady(
      userId,
      hash,
      locale,
      PRACTICE_RECOMMENDATION_PROMPT_VERSION,
    );
    if (ready?.recommendation)
      return { status: 'ready', insights, recommendation: ready.recommendation };
    const pending = await this.repository.claimPending(
      userId,
      hash,
      locale,
      PRACTICE_RECOMMENDATION_PROMPT_VERSION,
      insights,
    );
    if (!pending) {
      // Slot is owned by an active pending row, or a ready one just landed concurrently.
      const readyNow = await this.repository.findReady(
        userId,
        hash,
        locale,
        PRACTICE_RECOMMENDATION_PROMPT_VERSION,
      );
      if (readyNow?.recommendation)
        return { status: 'ready', insights, recommendation: readyNow.recommendation };
      throw new PracticeRecommendationError(
        PracticeRecommendationErrorCode.RECOMMENDATION_IN_PROGRESS,
      );
    }
    try {
      const recommendation = await this.generator.generate(locale, insights, candidates);
      await this.repository.markReady(pending.id, recommendation);
      return { status: 'ready', insights, recommendation };
    } catch (error) {
      await this.repository.markFailed(pending.id);
      if (error instanceof PracticeRecommendationError) throw error;
      const code = (error as any)?.code;
      if (code === 'AI_INVALID_RESPONSE' || (error as Error).message === 'AI_INVALID_RESPONSE')
        throw new PracticeRecommendationError(PracticeRecommendationErrorCode.AI_INVALID_RESPONSE);
      if (code === 'rate_limited')
        throw new PracticeRecommendationError(PracticeRecommendationErrorCode.AI_RATE_LIMITED);
      if (code === 'timeout')
        throw new PracticeRecommendationError(PracticeRecommendationErrorCode.AI_REQUEST_TIMEOUT);
      if (code === 'not_configured')
        throw new PracticeRecommendationError(
          PracticeRecommendationErrorCode.AI_CONFIGURATION_ERROR,
        );
      if (code === 'invalid_json_response' || code === 'empty_response')
        throw new PracticeRecommendationError(PracticeRecommendationErrorCode.AI_INVALID_RESPONSE);
      throw new PracticeRecommendationError(
        PracticeRecommendationErrorCode.AI_PROVIDER_UNAVAILABLE,
      );
    }
  }
}
