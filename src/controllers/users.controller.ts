import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse } from '@lib/response';
import { JwtService } from '@lib/auth';
import { EnglishLevel, GoalStatus, TargetExam } from '../models/enums';
import { UsersService } from 'src/services/users.service';
import type { CreateGoalBody, ProfileData, UpdateGoalBody } from 'src/interfaces/users.interface';
import type { JwtPayload } from 'src/interfaces/auth.interface';

const service = new UsersService();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAuthenticatedPayload(event: APIGatewayProxyEvent): JwtPayload | null {
  const authHeader = event.headers?.['Authorization'] ?? event.headers?.['authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    return JwtService.verify(token);
  } catch {
    return null;
  }
}

function handleError(err: unknown): APIGatewayProxyResult {
  const error = err as { message?: string; statusCode?: number };
  const status = error.statusCode ?? 500;
  const message = status < 500 ? (error.message ?? 'Error') : 'Internal server error';
  return errorResponse(message, status);
}

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ── GET /users/me ─────────────────────────────────────────────────────────────

export async function getMe(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.getMe(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /users/me/profile ───────────────────────────────────────────────────

export async function updateProfile(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: ProfileData;
  try {
    body = JSON.parse(event.body ?? '{}') as ProfileData;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (
    body.currentLevel !== undefined &&
    !(Object.values(EnglishLevel) as string[]).includes(body.currentLevel)
  ) {
    return errorResponse('Invalid currentLevel value', 400);
  }

  if (
    body.targetExam !== undefined &&
    !(Object.values(TargetExam) as string[]).includes(body.targetExam)
  ) {
    return errorResponse('Invalid targetExam value', 400);
  }

  if (
    body.targetScore !== undefined &&
    (!Number.isInteger(body.targetScore) || body.targetScore <= 0)
  ) {
    return errorResponse('targetScore must be a positive integer', 400);
  }

  if (
    body.studyDaysPerWeek !== undefined &&
    (!Number.isInteger(body.studyDaysPerWeek) || body.studyDaysPerWeek < 1 || body.studyDaysPerWeek > 7)
  ) {
    return errorResponse('studyDaysPerWeek must be between 1 and 7', 400);
  }

  if (
    body.dailyStudyMinutes !== undefined &&
    (!Number.isInteger(body.dailyStudyMinutes) || body.dailyStudyMinutes <= 0)
  ) {
    return errorResponse('dailyStudyMinutes must be greater than 0', 400);
  }

  if (body.targetDate !== undefined && isNaN(Date.parse(body.targetDate))) {
    return errorResponse('targetDate must be a valid date', 400);
  }

  try {
    const result = await service.updateProfile(payload.sub, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /users/me/goals ───────────────────────────────────────────────────────

export async function getGoals(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.getGoals(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── POST /users/me/goals ──────────────────────────────────────────────────────

export async function createGoal(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateGoalBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateGoalBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.title || body.title.trim() === '') {
    return errorResponse('title is required', 400);
  }

  if (
    body.status !== undefined &&
    !(Object.values(GoalStatus) as string[]).includes(body.status)
  ) {
    return errorResponse('Invalid status value', 400);
  }

  if (
    body.targetScore !== undefined &&
    (!Number.isInteger(body.targetScore) || body.targetScore <= 0)
  ) {
    return errorResponse('targetScore must be a positive integer', 400);
  }

  if (body.targetDate !== undefined && isNaN(Date.parse(body.targetDate))) {
    return errorResponse('targetDate must be a valid date', 400);
  }

  try {
    const result = await service.createGoal(payload.sub, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /users/me/goals/:goalId ─────────────────────────────────────────────

export async function updateGoal(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const goalId = event.pathParameters?.goalId ?? '';
  if (!goalId || !isValidUuid(goalId)) {
    return errorResponse('Invalid or missing goalId', 400);
  }

  let body: UpdateGoalBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateGoalBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  let hasFields = false;
  const bodyKeys = Object.keys(body) as (keyof UpdateGoalBody)[];
  for (let i = 0; i < bodyKeys.length; i++) {
    if (body[bodyKeys[i]] !== undefined) {
      hasFields = true;
      break;
    }
  }
  if (!hasFields) {
    return errorResponse('Request body must not be empty', 400);
  }

  if (
    body.status !== undefined &&
    !(Object.values(GoalStatus) as string[]).includes(body.status)
  ) {
    return errorResponse('Invalid status value', 400);
  }

  if (
    body.targetScore !== undefined &&
    (!Number.isInteger(body.targetScore) || body.targetScore <= 0)
  ) {
    return errorResponse('targetScore must be a positive integer', 400);
  }

  if (body.targetDate !== undefined && isNaN(Date.parse(body.targetDate))) {
    return errorResponse('targetDate must be a valid date', 400);
  }

  try {
    const result = await service.updateGoal(payload.sub, goalId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /users/me/goals/:goalId ────────────────────────────────────────────

export async function deleteGoal(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const goalId = event.pathParameters?.goalId ?? '';
  if (!goalId || !isValidUuid(goalId)) {
    return errorResponse('Invalid or missing goalId', 400);
  }

  try {
    await service.deleteGoal(payload.sub, goalId);
    return successResponse({ success: true, data: null }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
