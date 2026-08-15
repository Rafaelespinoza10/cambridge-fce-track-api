import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { ProgressService } from '../services/progress/progress.service';

const service = new ProgressService();

// ── GET /metrics ───────────────────────────────────────────────────────────────

export async function getMetrics(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.getMetrics(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

export async function getExamPartMetrics(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.getExamPartMetrics(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

export async function getWritingMetrics(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.getWritingMetrics(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

export async function getScoreEvolution(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const params = event.queryStringParameters ?? {};
  if (!params.from || !params.to) {
    return errorResponse('from and to query params are required', 400);
  }

  try {
    const result = await service.getScoreEvolution(payload.sub, params.from, params.to);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
