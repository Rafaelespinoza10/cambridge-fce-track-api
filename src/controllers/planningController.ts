import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  errorResponse,
  successResponse,
  csvResponse,
  handleError,
  isValidUuid,
} from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { toCsv } from '@lib/csv';
import { ActivityPriority, PlannedActivityStatus } from '../models/enums';
import { PlanningService } from '../services/planning/planning.service';
import type {
  CreateWeekPlanBody,
  AddPlannedActivityBody,
  UpdatePlannedActivityBody,
  MovePlannedActivityBody,
  ActivityHistoryFilters,
  ActivityHistoryExportRow,
} from '../interfaces/planning/planning.interface';

const service = new PlanningService();

// ── POST /plans/weeks ──────────────────────────────────────────────────────────

export async function createWeekPlan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateWeekPlanBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateWeekPlanBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.weekStartDate || body.weekStartDate.trim() === '') {
    return errorResponse('weekStartDate is required', 400);
  }

  try {
    const result = await service.createWeekPlan(payload.sub, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /plans/current ─────────────────────────────────────────────────────────

export async function getCurrentPlan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const result = await service.getCurrentPlan(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /plans/weeks/:weekId ───────────────────────────────────────────────────

export async function getWeekPlan(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const weekId = event.pathParameters?.weekId ?? '';
  if (!weekId || !isValidUuid(weekId)) {
    return errorResponse('Invalid or missing weekId', 400);
  }

  try {
    const result = await service.getWeekPlan(payload.sub, weekId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── POST /plans/weeks/:weekId/days/:dayId/activities ──────────────────────────

export async function addActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const weekId = event.pathParameters?.weekId ?? '';
  if (!weekId || !isValidUuid(weekId)) {
    return errorResponse('Invalid or missing weekId', 400);
  }

  const dayId = event.pathParameters?.dayId ?? '';
  if (!dayId || !isValidUuid(dayId)) {
    return errorResponse('Invalid or missing dayId', 400);
  }

  let body: AddPlannedActivityBody;
  try {
    body = JSON.parse(event.body ?? '{}') as AddPlannedActivityBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (
    body.activityTemplateId !== undefined &&
    body.activityTemplateId !== null &&
    !isValidUuid(body.activityTemplateId)
  ) {
    return errorResponse('activityTemplateId must be a valid UUID', 400);
  }

  if (
    body.customActivityId !== undefined &&
    body.customActivityId !== null &&
    !isValidUuid(body.customActivityId)
  ) {
    return errorResponse('customActivityId must be a valid UUID', 400);
  }

  if (body.skillId !== undefined && body.skillId !== null && !isValidUuid(body.skillId)) {
    return errorResponse('skillId must be a valid UUID', 400);
  }

  if (
    body.examSectionId !== undefined &&
    body.examSectionId !== null &&
    !isValidUuid(body.examSectionId)
  ) {
    return errorResponse('examSectionId must be a valid UUID', 400);
  }

  if (
    body.priority !== undefined &&
    !(Object.values(ActivityPriority) as string[]).includes(body.priority)
  ) {
    return errorResponse('priority must be low, medium, or high', 400);
  }

  if (
    body.estimatedDurationMinutes !== undefined &&
    body.estimatedDurationMinutes !== null &&
    (!Number.isInteger(body.estimatedDurationMinutes) || body.estimatedDurationMinutes <= 0)
  ) {
    return errorResponse('estimatedDurationMinutes must be a positive integer', 400);
  }

  try {
    const result = await service.addActivity(payload.sub, weekId, dayId, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /plans/activities/:plannedActivityId ─────────────────────────────────

export async function updateActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const plannedActivityId = event.pathParameters?.plannedActivityId ?? '';
  if (!plannedActivityId || !isValidUuid(plannedActivityId)) {
    return errorResponse('Invalid or missing plannedActivityId', 400);
  }

  let body: UpdatePlannedActivityBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdatePlannedActivityBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const bodyKeys = Object.keys(body) as (keyof UpdatePlannedActivityBody)[];
  const hasFields = bodyKeys.some(function (key: keyof UpdatePlannedActivityBody): boolean {
    return body[key] !== undefined;
  });
  if (!hasFields) {
    return errorResponse('Request body must not be empty', 400);
  }

  if (body.skillId !== undefined && body.skillId !== null && !isValidUuid(body.skillId)) {
    return errorResponse('skillId must be a valid UUID', 400);
  }

  if (
    body.examSectionId !== undefined &&
    body.examSectionId !== null &&
    !isValidUuid(body.examSectionId)
  ) {
    return errorResponse('examSectionId must be a valid UUID', 400);
  }

  if (
    body.priority !== undefined &&
    !(Object.values(ActivityPriority) as string[]).includes(body.priority)
  ) {
    return errorResponse('priority must be low, medium, or high', 400);
  }

  if (
    body.status !== undefined &&
    !(Object.values(PlannedActivityStatus) as string[]).includes(body.status)
  ) {
    return errorResponse('status must be pending, in_progress, completed, or skipped', 400);
  }

  if (
    body.estimatedDurationMinutes !== undefined &&
    body.estimatedDurationMinutes !== null &&
    (!Number.isInteger(body.estimatedDurationMinutes) || body.estimatedDurationMinutes <= 0)
  ) {
    return errorResponse('estimatedDurationMinutes must be a positive integer', 400);
  }

  try {
    const result = await service.updateActivity(payload.sub, plannedActivityId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /plans/activities/:plannedActivityId ────────────────────────────────

export async function deleteActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const plannedActivityId = event.pathParameters?.plannedActivityId ?? '';
  if (!plannedActivityId || !isValidUuid(plannedActivityId)) {
    return errorResponse('Invalid or missing plannedActivityId', 400);
  }

  try {
    await service.deleteActivity(payload.sub, plannedActivityId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /plans/activities/:plannedActivityId/move ───────────────────────────

export async function moveActivity(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const plannedActivityId = event.pathParameters?.plannedActivityId ?? '';
  if (!plannedActivityId || !isValidUuid(plannedActivityId)) {
    return errorResponse('Invalid or missing plannedActivityId', 400);
  }

  let body: MovePlannedActivityBody;
  try {
    body = JSON.parse(event.body ?? '{}') as MovePlannedActivityBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.targetDayId || !isValidUuid(body.targetDayId)) {
    return errorResponse('targetDayId must be a valid UUID', 400);
  }

  if (
    body.targetOrder === undefined ||
    body.targetOrder === null ||
    !Number.isInteger(body.targetOrder) ||
    body.targetOrder < 0
  ) {
    return errorResponse('targetOrder must be an integer >= 0', 400);
  }

  try {
    const result = await service.moveActivity(payload.sub, plannedActivityId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /plans/activities ──────────────────────────────────────────────────────

export async function getActivityHistory(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};

  const limit = qs['limit'] !== undefined ? parseInt(qs['limit'], 10) : 20;
  const offset = qs['offset'] !== undefined ? parseInt(qs['offset'], 10) : 0;

  if (isNaN(limit) || limit <= 0) return errorResponse('limit must be a positive integer', 400);
  if (isNaN(offset) || offset < 0)
    return errorResponse('offset must be a non-negative integer', 400);

  const skillId = qs['skillId'] ?? undefined;
  if (skillId !== undefined && !isValidUuid(skillId)) {
    return errorResponse('skillId must be a valid UUID', 400);
  }

  const status = qs['status'] as PlannedActivityStatus | undefined;
  if (
    status !== undefined &&
    !(Object.values(PlannedActivityStatus) as string[]).includes(status)
  ) {
    return errorResponse('status must be pending, in_progress, completed, or skipped', 400);
  }

  const filters: ActivityHistoryFilters = {
    skillId,
    status,
    from: qs['from'] ?? undefined,
    to: qs['to'] ?? undefined,
    limit,
    offset,
  };

  try {
    const result = await service.getActivityHistory(payload.sub, filters);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /plans/activities/export ───────────────────────────────────────────────

const ACTIVITY_HISTORY_EXPORT_COLUMNS: { key: keyof ActivityHistoryExportRow; header: string }[] = [
  { key: 'plannedActivityId', header: 'Planned Activity ID' },
  { key: 'weeklyPlanId', header: 'Weekly Plan ID' },
  { key: 'date', header: 'Date' },
  { key: 'title', header: 'Title' },
  { key: 'description', header: 'Description' },
  { key: 'skillName', header: 'Skill' },
  { key: 'examSectionId', header: 'Exam Section ID' },
  { key: 'priority', header: 'Priority' },
  { key: 'status', header: 'Status' },
  { key: 'scheduledAt', header: 'Scheduled At' },
  { key: 'completedAt', header: 'Completed At' },
  { key: 'estimatedDurationMinutes', header: 'Estimated Duration (min)' },
];

export async function exportActivityHistory(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};

  const skillId = qs['skillId'] ?? undefined;
  if (skillId !== undefined && !isValidUuid(skillId)) {
    return errorResponse('skillId must be a valid UUID', 400);
  }

  const status = qs['status'] as PlannedActivityStatus | undefined;
  if (
    status !== undefined &&
    !(Object.values(PlannedActivityStatus) as string[]).includes(status)
  ) {
    return errorResponse('status must be pending, in_progress, completed, or skipped', 400);
  }

  const filters: Omit<ActivityHistoryFilters, 'limit' | 'offset'> = {
    skillId,
    status,
    from: qs['from'] ?? undefined,
    to: qs['to'] ?? undefined,
  };

  try {
    const rows = await service.exportActivityHistory(payload.sub, filters);
    const csv = toCsv(rows, ACTIVITY_HISTORY_EXPORT_COLUMNS);
    return csvResponse(csv, 'activity-history-export.csv');
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── POST /plans/activities/import ──────────────────────────────────────────────

export async function importActivityHistory(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const csvText = event.body ?? '';
  if (csvText.trim() === '') return errorResponse('Request body must not be empty', 400);

  try {
    const result = await service.importActivityHistory(payload.sub, csvText);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
