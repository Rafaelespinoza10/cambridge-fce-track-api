import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { RecommendationsService } from '../services/recommendations/recommendations.service';
import type { UpdateRecommendationBody } from '../interfaces/recommendations/recommendations.interface';

const service = new RecommendationsService();

// ── GET /recommendations ────────────────────────────────────────────────────────

export async function getRecommendations(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};
  const filters = {
    status: qs.status ?? undefined,
    type: qs.type ?? undefined,
    limit: qs.limit !== undefined ? parseInt(qs.limit, 10) : undefined,
    offset: qs.offset !== undefined ? parseInt(qs.offset, 10) : undefined,
  };

  try {
    const result = await service.getRecommendations(payload.sub, filters);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── POST /recommendations/generate ─────────────────────────────────────────────

export async function generateRecommendations(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.generateRecommendations(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /recommendations/{recommendationId} ───────────────────────────────────

export async function updateRecommendation(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const recommendationId = event.pathParameters?.recommendationId ?? '';
  if (!recommendationId || !isValidUuid(recommendationId)) {
    return errorResponse('Invalid or missing recommendationId', 400);
  }

  let body: UpdateRecommendationBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateRecommendationBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const result = await service.updateRecommendation(payload.sub, recommendationId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /recommendations/{recommendationId} ──────────────────────────────────

export async function deleteRecommendation(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const recommendationId = event.pathParameters?.recommendationId ?? '';
  if (!recommendationId || !isValidUuid(recommendationId)) {
    return errorResponse('Invalid or missing recommendationId', 400);
  }

  try {
    await service.deleteRecommendation(payload.sub, recommendationId);
    return successResponse({ success: true, data: null }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
