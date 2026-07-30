import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { EvidenceService } from '../services/evidence.service';
import type {
  CreateEvidenceBody,
  EvidenceListFilters,
  GenerateUploadUrlBody,
} from '../interfaces/evidence.interface';

const service = new EvidenceService();

// ── POST /evidence/upload-url ──────────────────────────────────────────────────

export async function generateUploadUrl(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GenerateUploadUrlBody;
  try {
    body = JSON.parse(event.body ?? '{}') as GenerateUploadUrlBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const result = await service.generateUploadUrl(payload.sub, body);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── POST /evidence ─────────────────────────────────────────────────────────────

export async function createEvidence(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateEvidenceBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateEvidenceBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const result = await service.createEvidence(payload.sub, body);
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /evidence ──────────────────────────────────────────────────────────────

export async function listEvidence(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const qs = event.queryStringParameters ?? {};
  const limit = qs['limit'] !== undefined ? parseInt(qs['limit'], 10) : 20;
  const offset = qs['offset'] !== undefined ? parseInt(qs['offset'], 10) : 0;

  if (isNaN(limit) || limit <= 0) return errorResponse('limit must be a positive integer', 400);
  if (isNaN(offset) || offset < 0)
    return errorResponse('offset must be a non-negative integer', 400);

  const filters: EvidenceListFilters = {
    linkedTo: qs['linkedTo'] as EvidenceListFilters['linkedTo'],
    linkedId: qs['linkedId'] ?? undefined,
    limit,
    offset,
  };

  try {
    const result = await service.listEvidence(payload.sub, filters);
    return successResponse({ success: true, ...result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── GET /evidence/{evidenceId} ─────────────────────────────────────────────────

export async function getEvidence(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const evidenceId = event.pathParameters?.evidenceId ?? '';
  if (!evidenceId || !isValidUuid(evidenceId))
    return errorResponse('Invalid or missing evidenceId', 400);

  try {
    const result = await service.getEvidence(payload.sub, evidenceId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

// ── DELETE /evidence/{evidenceId} ──────────────────────────────────────────────

export async function deleteEvidence(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const evidenceId = event.pathParameters?.evidenceId ?? '';
  if (!evidenceId || !isValidUuid(evidenceId))
    return errorResponse('Invalid or missing evidenceId', 400);

  try {
    await service.deleteEvidence(payload.sub, evidenceId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}
