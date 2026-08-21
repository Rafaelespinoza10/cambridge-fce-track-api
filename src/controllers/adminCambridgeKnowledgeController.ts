import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/response';
import { getAuthenticatedAdminPayload } from '@lib/admin-auth';
import { buildCambridgeKnowledgeServices } from '../services/cambridge-knowledge/cambridge-knowledge-composition';
import {
  ImportCambridgeKnowledgeError,
  ImportCambridgeKnowledgeErrorCode,
} from '../services/cambridge-knowledge/import-cambridge-knowledge.service';
import type {
  ImportCambridgeKnowledgeInput,
  ImportCambridgeKnowledgeResult,
} from '../services/cambridge-knowledge/import-cambridge-knowledge.service';
import {
  SearchCambridgeKnowledgeError,
  SearchCambridgeKnowledgeErrorCode,
} from '../services/cambridge-knowledge/search-cambridge-knowledge.service';
import type {
  SearchCambridgeKnowledgeFilters,
  CambridgeKnowledgeSearchResult,
} from '../services/cambridge-knowledge/search-cambridge-knowledge.service';
import type { CambridgeSourceDto } from '../repositories/cambridge-sources.repository';

interface ImportServicePort {
  execute(input: ImportCambridgeKnowledgeInput): Promise<ImportCambridgeKnowledgeResult>;
}
interface SearchServicePort {
  execute(filters: SearchCambridgeKnowledgeFilters): Promise<CambridgeKnowledgeSearchResult[]>;
}
interface ListSourcesServicePort {
  execute(): Promise<CambridgeSourceDto[]>;
}

interface AdminCambridgeKnowledgeControllerDeps {
  services: () => Promise<{
    importKnowledge: ImportServicePort;
    searchKnowledge: SearchServicePort;
    listSources: ListSourcesServicePort;
  }>;
}

const DEFAULT_DEPS: AdminCambridgeKnowledgeControllerDeps = {
  services: buildCambridgeKnowledgeServices,
};

const IMPORT_ERROR_STATUS: Record<ImportCambridgeKnowledgeErrorCode, number> = {
  [ImportCambridgeKnowledgeErrorCode.INVALID_INPUT]: 400,
  [ImportCambridgeKnowledgeErrorCode.EXTRACTION_FAILED]: 422,
  [ImportCambridgeKnowledgeErrorCode.AI_RATE_LIMITED]: 429,
  [ImportCambridgeKnowledgeErrorCode.AI_INVALID_RESPONSE]: 502,
  [ImportCambridgeKnowledgeErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [ImportCambridgeKnowledgeErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [ImportCambridgeKnowledgeErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [ImportCambridgeKnowledgeErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

function mapImportError(error: unknown): APIGatewayProxyResult {
  if (error instanceof ImportCambridgeKnowledgeError) {
    return errorResponse(error.code, IMPORT_ERROR_STATUS[error.code] ?? 500);
  }
  return handleError(error);
}

function mapSearchError(error: unknown): APIGatewayProxyResult {
  if (error instanceof SearchCambridgeKnowledgeError) {
    const status = error.code === SearchCambridgeKnowledgeErrorCode.INVALID_INPUT ? 400 : 500;
    return errorResponse(error.code, status);
  }
  return handleError(error);
}

// Every handler below takes `deps` explicitly (only ever supplied by
// tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS — same shape as writingTaskController.ts.

// ── POST /admin/cambridge-knowledge/sources ─────────────────────────────────
// Admin-only, internal tooling endpoint — no public UI consumes this (see
// docs/cambridge-knowledge-base.md). JSON body, not multipart: the PDF
// travels as a base64 string (`fileBase64`) alongside its metadata, exactly
// like every other endpoint in this API parses a plain JSON body — no new
// multipart-parsing dependency for an admin-only path.

interface ImportSourceRequestBody {
  name?: unknown;
  description?: unknown;
  version?: unknown;
  fileBase64?: unknown;
}

async function importCambridgeSourceHandler(
  event: APIGatewayProxyEvent,
  deps: AdminCambridgeKnowledgeControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedAdminPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: ImportSourceRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as ImportSourceRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (typeof body.name !== 'string') return errorResponse('name is required', 400);
  if (typeof body.version !== 'string') return errorResponse('version is required', 400);
  if (typeof body.fileBase64 !== 'string' || body.fileBase64.trim() === '') {
    return errorResponse('fileBase64 is required', 400);
  }

  let file: Buffer;
  try {
    file = Buffer.from(body.fileBase64, 'base64');
  } catch {
    return errorResponse('fileBase64 must be valid base64', 400);
  }

  try {
    const { importKnowledge } = await deps.services();
    const result = await importKnowledge.execute({
      name: body.name,
      description: typeof body.description === 'string' ? body.description : null,
      version: body.version,
      file,
    });
    return successResponse({ success: true, data: result }, result.idempotentReplay ? 200 : 201);
  } catch (err: unknown) {
    return mapImportError(err);
  }
}

export async function importCambridgeSource(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return importCambridgeSourceHandler(event, DEFAULT_DEPS);
}

// ── GET /admin/cambridge-knowledge/sources ──────────────────────────────────

async function listCambridgeSourcesHandler(
  event: APIGatewayProxyEvent,
  deps: AdminCambridgeKnowledgeControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedAdminPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { listSources } = await deps.services();
    const sources = await listSources.execute();
    return successResponse({ success: true, data: sources }, 200);
  } catch (err: unknown) {
    return handleError(err);
  }
}

export async function listCambridgeSources(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return listCambridgeSourcesHandler(event, DEFAULT_DEPS);
}

// ── POST /admin/cambridge-knowledge/search ──────────────────────────────────

interface SearchRequestBody {
  query?: unknown;
  paperCode?: unknown;
  partCode?: unknown;
  skill?: unknown;
  topic?: unknown;
  limit?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

async function searchCambridgeKnowledgeHandler(
  event: APIGatewayProxyEvent,
  deps: AdminCambridgeKnowledgeControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedAdminPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: SearchRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as SearchRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { searchKnowledge } = await deps.services();
    const results = await searchKnowledge.execute({
      query: optionalString(body.query),
      paperCode: optionalString(body.paperCode),
      partCode: optionalString(body.partCode),
      skill: optionalString(body.skill),
      topic: optionalString(body.topic),
      limit: typeof body.limit === 'number' ? body.limit : undefined,
    });
    return successResponse({ success: true, data: results }, 200);
  } catch (err: unknown) {
    return mapSearchError(err);
  }
}

export async function searchCambridgeKnowledge(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return searchCambridgeKnowledgeHandler(event, DEFAULT_DEPS);
}

export {
  importCambridgeSourceHandler,
  listCambridgeSourcesHandler,
  searchCambridgeKnowledgeHandler,
};
export type { AdminCambridgeKnowledgeControllerDeps };
