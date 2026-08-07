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
import { MocksService } from '../services/mocks/mocks.service';
import { ExamType, MockType } from '../models/enums';
import type {
  CreateMockBody,
  UpdateMockBody,
  MockListFilters,
  MockExportRow,
} from '../interfaces/mocks/mocks.interface';

const service = new MocksService();

// GET /mocks/catalog/{examType}/sections
export async function getMockSectionCatalog(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const examType = event.pathParameters?.examType as ExamType | undefined;
  if (examType === undefined) return errorResponse('examType is required', 400);
  try {
    return successResponse({ success: true, data: service.getSectionCatalog(examType) }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

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

// ── GET /mocks/export ──────────────────────────────────────────────────────────

const MOCK_EXPORT_COLUMNS: { key: keyof MockExportRow; header: string }[] = [
  { key: 'mockId', header: 'Mock ID' },
  { key: 'mockName', header: 'Mock Name' },
  { key: 'examType', header: 'Exam Type' },
  { key: 'mockType', header: 'Mock Type' },
  { key: 'takenAt', header: 'Taken At' },
  { key: 'estimatedStandardizedScore', header: 'Estimated Standardized Score' },
  { key: 'scoreScale', header: 'Score Scale' },
  { key: 'estimatedLevel', header: 'Estimated Level' },
  { key: 'notes', header: 'Notes' },
  { key: 'sectionCode', header: 'Section Code' },
  { key: 'sectionName', header: 'Section' },
  { key: 'rawScore', header: 'Raw Score' },
  { key: 'maxScore', header: 'Max Score' },
  { key: 'percentage', header: 'Percentage' },
  { key: 'standardizedScore', header: 'Section Standardized Score' },
  { key: 'sectionNotes', header: 'Section Notes' },
];

export async function exportMocks(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};

  const examType = qs['examType'] as ExamType | undefined;
  if (examType !== undefined && !(Object.values(ExamType) as string[]).includes(examType)) {
    return errorResponse(`examType must be one of: ${Object.values(ExamType).join(', ')}`, 400);
  }

  const mockType = qs['mockType'] as MockType | undefined;
  if (mockType !== undefined && !(Object.values(MockType) as string[]).includes(mockType)) {
    return errorResponse(`mockType must be one of: ${Object.values(MockType).join(', ')}`, 400);
  }

  const filters: Omit<MockListFilters, 'limit' | 'offset'> = {
    examType,
    mockType,
    from: qs['from'] ?? undefined,
    to: qs['to'] ?? undefined,
  };

  try {
    const rows = await service.exportMocks(payload.sub, filters);
    const csv = toCsv(rows, MOCK_EXPORT_COLUMNS);
    return csvResponse(csv, 'mocks-export.csv');
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

// ── POST /mocks/import ─────────────────────────────────────────────────────────

export async function importMocks(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const csvText = event.body ?? '';
  if (csvText.trim() === '') return errorResponse('Request body must not be empty', 400);

  try {
    const result = await service.importMocks(payload.sub, csvText);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
