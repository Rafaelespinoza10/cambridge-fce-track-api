import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { MocksService } from '../services/mocks.service';
import { ExamType, MockType } from '../models/enums';
import type {
  CreateMockBody,
  UpdateMockBody,
  MockListFilters,
} from '../interfaces/mocks.interface';

const service = new MocksService();

// ── POST /mocks ────────────────────────────────────────────────────────────────

export async function createMock(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateMockBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateMockBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.name) return errorResponse('name is required', 400);

  try {
    const result = await service.createMock(payload.sub, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /mocks ─────────────────────────────────────────────────────────────────

export async function listMocks(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};

  const limit = qs['limit'] !== undefined ? parseInt(qs['limit'], 10) : 20;
  const offset = qs['offset'] !== undefined ? parseInt(qs['offset'], 10) : 0;

  if (isNaN(limit) || limit <= 0) return errorResponse('limit must be a positive integer', 400);
  if (isNaN(offset) || offset < 0)
    return errorResponse('offset must be a non-negative integer', 400);

  const examType = qs['examType'] as ExamType | undefined;
  if (examType !== undefined && !(Object.values(ExamType) as string[]).includes(examType)) {
    return errorResponse(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
  }

  const mockType = qs['mockType'] as MockType | undefined;
  if (mockType !== undefined && !(Object.values(MockType) as string[]).includes(mockType)) {
    return errorResponse(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
  }

  const filters: MockListFilters = {
    examType,
    mockType,
    from: qs['from'] ?? undefined,
    to: qs['to'] ?? undefined,
    limit,
    offset,
  };

  try {
    const result = await service.listMocks(payload.sub, filters);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /mocks/{mockId} ────────────────────────────────────────────────────────

export async function getMock(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const mockId = event.pathParameters?.mockId ?? '';
  if (!mockId || !isValidUuid(mockId)) return errorResponse('Invalid or missing mockId', 400);

  try {
    const result = await service.getMock(payload.sub, mockId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── PATCH /mocks/{mockId} ──────────────────────────────────────────────────────

export async function updateMock(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const mockId = event.pathParameters?.mockId ?? '';
  if (!mockId || !isValidUuid(mockId)) return errorResponse('Invalid or missing mockId', 400);

  let body: UpdateMockBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateMockBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (Object.keys(body).length === 0) return errorResponse('Request body must not be empty', 400);

  try {
    const result = await service.updateMock(payload.sub, mockId, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /mocks/{mockId} ─────────────────────────────────────────────────────

export async function deleteMock(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const mockId = event.pathParameters?.mockId ?? '';
  if (!mockId || !isValidUuid(mockId)) return errorResponse('Invalid or missing mockId', 400);

  try {
    await service.deleteMock(payload.sub, mockId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
