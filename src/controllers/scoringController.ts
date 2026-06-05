import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { ScoringService } from '../services/scoring.service';
import type {
  RegisterScoreBody,
  UpdateScoreBody,
  ScoreHistoryFilters,
} from '../interfaces/scoring.interface';
import { ScoreType } from '../models/enums';

const service = new ScoringService();

// ── POST /scores/activities/{plannedActivityId} ────────────────────────────────

export async function registerScore(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const plannedActivityId = event.pathParameters?.plannedActivityId ?? '';
  if (!plannedActivityId || !isValidUuid(plannedActivityId)) {
    return errorResponse('Invalid or missing plannedActivityId', 400);
  }

  let body: RegisterScoreBody;
  try {
    body = JSON.parse(event.body ?? '{}') as RegisterScoreBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.scoreType) {
    return errorResponse('scoreType is required', 400);
  }

  if (
    body.correctAnswers !== undefined &&
    body.correctAnswers !== null &&
    (!Number.isInteger(body.correctAnswers) || body.correctAnswers < 0)
  ) {
    return errorResponse('correctAnswers must be a non-negative integer', 400);
  }

  if (
    body.totalQuestions !== undefined &&
    body.totalQuestions !== null &&
    (!Number.isInteger(body.totalQuestions) || body.totalQuestions <= 0)
  ) {
    return errorResponse('totalQuestions must be a positive integer', 400);
  }

  if (
    body.timeSpentMinutes !== undefined &&
    body.timeSpentMinutes !== null &&
    (!Number.isInteger(body.timeSpentMinutes) || body.timeSpentMinutes <= 0)
  ) {
    return errorResponse('timeSpentMinutes must be a positive integer', 400);
  }

  try {
    const result = await service.registerScore(payload.sub, plannedActivityId, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /scores/activities/{plannedActivityId} ─────────────────────────────────

export async function getScoresByActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const plannedActivityId = event.pathParameters?.plannedActivityId ?? '';
  if (!plannedActivityId || !isValidUuid(plannedActivityId)) {
    return errorResponse('Invalid or missing plannedActivityId', 400);
  }

  try {
    const result = await service.getScoresByActivity(payload.sub, plannedActivityId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /scores/{scoreId} ──────────────────────────────────────────────────────

export async function getScore(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const scoreId = event.pathParameters?.scoreId ?? '';
  if (!scoreId || !isValidUuid(scoreId)) {
    return errorResponse('Invalid or missing scoreId', 400);
  }

  try {
    const result = await service.getScore(payload.sub, scoreId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /scores/{scoreId} ────────────────────────────────────────────────────

export async function updateScore(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const scoreId = event.pathParameters?.scoreId ?? '';
  if (!scoreId || !isValidUuid(scoreId)) {
    return errorResponse('Invalid or missing scoreId', 400);
  }

  let body: UpdateScoreBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateScoreBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const bodyKeys = Object.keys(body);
  if (bodyKeys.length === 0) {
    return errorResponse('Request body must not be empty', 400);
  }

  if (
    body.correctAnswers !== undefined &&
    body.correctAnswers !== null &&
    (!Number.isInteger(body.correctAnswers) || body.correctAnswers < 0)
  ) {
    return errorResponse('correctAnswers must be a non-negative integer', 400);
  }

  if (
    body.totalQuestions !== undefined &&
    body.totalQuestions !== null &&
    (!Number.isInteger(body.totalQuestions) || body.totalQuestions <= 0)
  ) {
    return errorResponse('totalQuestions must be a positive integer', 400);
  }

  if (
    body.timeSpentMinutes !== undefined &&
    body.timeSpentMinutes !== null &&
    (!Number.isInteger(body.timeSpentMinutes) || body.timeSpentMinutes <= 0)
  ) {
    return errorResponse('timeSpentMinutes must be a positive integer', 400);
  }

  try {
    const result = await service.updateScore(payload.sub, scoreId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /scores/{scoreId} ───────────────────────────────────────────────────

export async function deleteScore(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const scoreId = event.pathParameters?.scoreId ?? '';
  if (!scoreId || !isValidUuid(scoreId)) {
    return errorResponse('Invalid or missing scoreId', 400);
  }

  try {
    await service.deleteScore(payload.sub, scoreId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /scores ────────────────────────────────────────────────────────────────

export async function getScoreHistory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};

  const limit = qs['limit'] !== undefined ? parseInt(qs['limit'], 10) : 20;
  const offset = qs['offset'] !== undefined ? parseInt(qs['offset'], 10) : 0;

  if (isNaN(limit) || limit <= 0) return errorResponse('limit must be a positive integer', 400);
  if (isNaN(offset) || offset < 0) return errorResponse('offset must be a non-negative integer', 400);

  const skillId = qs['skillId'] ?? undefined;
  if (skillId !== undefined && !isValidUuid(skillId)) {
    return errorResponse('skillId must be a valid UUID', 400);
  }

  const scoreType = qs['scoreType'] as ScoreType | undefined;
  if (scoreType !== undefined && !(Object.values(ScoreType) as string[]).includes(scoreType)) {
    return errorResponse(`scoreType must be one of: ${Object.values(ScoreType).join(', ')}`, 400);
  }

  const filters: ScoreHistoryFilters = {
    skillId,
    scoreType,
    from: qs['from'] ?? undefined,
    to: qs['to'] ?? undefined,
    limit,
    offset,
  };

  try {
    const result = await service.getScoreHistory(payload.sub, filters);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
