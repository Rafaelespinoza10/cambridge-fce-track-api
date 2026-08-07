import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { buildPracticeAdaptiveServices } from '../services/practice/practice-adaptive-composition';
import { PracticeRecommendationError } from '../services/practice/generate-practice-recommendation.service';
import type { PracticeLocale } from '../interfaces/practice/practice-adaptive.interface';
type Deps = { services: typeof buildPracticeAdaptiveServices };
const defaults: Deps = { services: buildPracticeAdaptiveServices };
function mapError(error: unknown): APIGatewayProxyResult {
  const code = error instanceof PracticeRecommendationError ? error.code : '';
  const statuses: Record<string, number> = {
    INVALID_INPUT: 400,
    RECOMMENDATION_IN_PROGRESS: 409,
    AI_RATE_LIMITED: 429,
    AI_INVALID_RESPONSE: 502,
    AI_PROVIDER_UNAVAILABLE: 503,
    AI_REQUEST_TIMEOUT: 504,
    AI_CONFIGURATION_ERROR: 500,
    PERSISTENCE_INCONSISTENCY: 500,
  };
  return errorResponse(code || 'Internal server error', statuses[code] ?? 500);
}
function localeOf(event: APIGatewayProxyEvent): PracticeLocale | null {
  let body: any = {};
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return null;
  }
  const locale = body.locale ?? 'en';
  return locale === 'en' || locale === 'es' ? locale : null;
}
async function insightsHandler(
  event: APIGatewayProxyEvent,
  deps: Deps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (!payload) return errorResponse('Unauthorized', 401);
  try {
    const { getInsights } = await deps.services();
    return successResponse({ success: true, data: await getInsights.execute(payload.sub) });
  } catch (e) {
    return mapError(e);
  }
}
async function recommendationsHandler(
  event: APIGatewayProxyEvent,
  deps: Deps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (!payload) return errorResponse('Unauthorized', 401);
  const locale = localeOf(event);
  if (!locale) return errorResponse('INVALID_INPUT', 400);
  try {
    const { generateRecommendation } = await deps.services();
    return successResponse({
      success: true,
      data: await generateRecommendation.execute(payload.sub, locale),
    });
  } catch (e) {
    return mapError(e);
  }
}
export async function getPracticeInsights(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return insightsHandler(event, defaults);
}
export async function postPracticeRecommendations(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return recommendationsHandler(event, defaults);
}
export { insightsHandler, recommendationsHandler };
