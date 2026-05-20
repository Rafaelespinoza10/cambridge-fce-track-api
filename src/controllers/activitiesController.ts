import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse } from '@lib/response';
import { JwtService } from '@lib/jwt';
import { ScoreType } from '../models/enums';
import { ActivitiesService } from 'src/services/activities.service';
import type { JwtPayload } from 'src/interfaces/auth.interface';
import type {
  CreateCustomActivityBody,
  UpdateCustomActivityBody,
  ExamSectionFilters,
  ActivityTemplateFilters,
  CustomActivityFilters,
} from 'src/interfaces/activities.interface';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const service = new ActivitiesService();

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

// ── GET /skills ───────────────────────────────────────────────────────────────

export async function getSkills(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const result = await service.getSkills();
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /exam-sections ────────────────────────────────────────────────────────

export async function getExamSections(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};

  const filters: ExamSectionFilters = {};

  if (params.skillId !== undefined && params.skillId !== '') {
    if (!isValidUuid(params.skillId)) {
      return errorResponse('skillId must be a valid UUID', 400);
    }
    filters.skillId = params.skillId;
  }

  if (params.skillSlug !== undefined && params.skillSlug !== '') {
    filters.skillSlug = params.skillSlug;
  }

  try {
    const result = await service.getExamSections(filters);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /activity-templates ───────────────────────────────────────────────────

export async function getActivityTemplates(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const params = event.queryStringParameters ?? {};

  const filters: ActivityTemplateFilters = {};

  if (params.skillId !== undefined && params.skillId !== '') {
    if (!isValidUuid(params.skillId)) {
      return errorResponse('skillId must be a valid UUID', 400);
    }
    filters.skillId = params.skillId;
  }

  if (params.skillSlug !== undefined && params.skillSlug !== '') {
    filters.skillSlug = params.skillSlug;
  }

  if (params.examSectionId !== undefined && params.examSectionId !== '') {
    if (!isValidUuid(params.examSectionId)) {
      return errorResponse('examSectionId must be a valid UUID', 400);
    }
    filters.examSectionId = params.examSectionId;
  }

  if (params.scoreType !== undefined && params.scoreType !== '') {
    if (!(Object.values(ScoreType) as string[]).includes(params.scoreType)) {
      return errorResponse('scoreType must be a valid value', 400);
    }
    filters.scoreType = params.scoreType as ScoreType;
  }

  if (params.isActive !== undefined && params.isActive !== '') {
    if (params.isActive === 'true') {
      filters.isActive = true;
    } else if (params.isActive === 'false') {
      filters.isActive = false;
    } else {
      return errorResponse('isActive must be true or false', 400);
    }
  }

  try {
    const result = await service.getActivityTemplates(filters);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── POST /custom-activities ───────────────────────────────────────────────────

export async function createCustomActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateCustomActivityBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateCustomActivityBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.name || body.name.trim() === '') {
    return errorResponse('name is required', 400);
  }

  if (!body.scoreType || !(Object.values(ScoreType) as string[]).includes(body.scoreType as string)) {
    return errorResponse('scoreType is required and must be a valid value', 400);
  }

  if (body.skillId !== undefined) {
    if (!isValidUuid(body.skillId)) {
      return errorResponse('skillId must be a valid UUID', 400);
    }
  }

  if (body.examSectionId !== undefined) {
    if (!isValidUuid(body.examSectionId)) {
      return errorResponse('examSectionId must be a valid UUID', 400);
    }
  }

  if (
    body.defaultDurationMinutes !== undefined &&
    (!Number.isInteger(body.defaultDurationMinutes) || body.defaultDurationMinutes <= 0)
  ) {
    return errorResponse('defaultDurationMinutes must be a positive integer', 400);
  }

  if (body.maxScore !== undefined && (!Number.isInteger(body.maxScore) || body.maxScore <= 0)) {
    return errorResponse('maxScore must be a positive integer', 400);
  }

  try {
    const result = await service.createCustomActivity(payload.sub, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /custom-activities ────────────────────────────────────────────────────

export async function getCustomActivities(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const params = event.queryStringParameters ?? {};

  const filters: CustomActivityFilters = {};

  if (params.skillId !== undefined && params.skillId !== '') {
    if (!isValidUuid(params.skillId)) {
      return errorResponse('skillId must be a valid UUID', 400);
    }
    filters.skillId = params.skillId;
  }

  if (params.skillSlug !== undefined && params.skillSlug !== '') {
    filters.skillSlug = params.skillSlug;
  }

  if (params.examSectionId !== undefined && params.examSectionId !== '') {
    if (!isValidUuid(params.examSectionId)) {
      return errorResponse('examSectionId must be a valid UUID', 400);
    }
    filters.examSectionId = params.examSectionId;
  }

  if (params.scoreType !== undefined && params.scoreType !== '') {
    if (!(Object.values(ScoreType) as string[]).includes(params.scoreType)) {
      return errorResponse('scoreType must be a valid value', 400);
    }
    filters.scoreType = params.scoreType as ScoreType;
  }

  try {
    const result = await service.getCustomActivities(payload.sub, filters);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /custom-activities/:id ──────────────────────────────────────────────

export async function updateCustomActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const activityId = event.pathParameters?.id ?? '';
  if (!activityId || !isValidUuid(activityId)) {
    return errorResponse('Invalid or missing activity id', 400);
  }

  let body: UpdateCustomActivityBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateCustomActivityBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  let hasFields = false;
  const bodyKeys = Object.keys(body) as (keyof UpdateCustomActivityBody)[];
  for (let i = 0; i < bodyKeys.length; i++) {
    if (body[bodyKeys[i]] !== undefined) {
      hasFields = true;
      break;
    }
  }
  if (!hasFields) {
    return errorResponse('Request body must not be empty', 400);
  }

  if (body.name !== undefined && body.name.trim() === '') {
    return errorResponse('name must not be empty', 400);
  }

  if (
    body.scoreType !== undefined &&
    !(Object.values(ScoreType) as string[]).includes(body.scoreType as string)
  ) {
    return errorResponse('scoreType must be a valid value', 400);
  }

  if (body.skillId !== undefined && body.skillId !== null) {
    if (!isValidUuid(body.skillId)) {
      return errorResponse('skillId must be a valid UUID', 400);
    }
  }

  if (body.examSectionId !== undefined && body.examSectionId !== null) {
    if (!isValidUuid(body.examSectionId)) {
      return errorResponse('examSectionId must be a valid UUID', 400);
    }
  }

  if (
    body.defaultDurationMinutes !== undefined &&
    body.defaultDurationMinutes !== null &&
    (!Number.isInteger(body.defaultDurationMinutes) || body.defaultDurationMinutes <= 0)
  ) {
    return errorResponse('defaultDurationMinutes must be a positive integer', 400);
  }

  if (
    body.maxScore !== undefined &&
    body.maxScore !== null &&
    (!Number.isInteger(body.maxScore) || body.maxScore <= 0)
  ) {
    return errorResponse('maxScore must be a positive integer', 400);
  }

  try {
    const result = await service.updateCustomActivity(payload.sub, activityId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /custom-activities/:id ─────────────────────────────────────────────

export async function deleteCustomActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const activityId = event.pathParameters?.id ?? '';
  if (!activityId || !isValidUuid(activityId)) {
    return errorResponse('Invalid or missing activity id', 400);
  }

  try {
    await service.deleteCustomActivity(payload.sub, activityId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
