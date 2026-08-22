import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/shared/response';
import { getAuthenticatedAdminPayload } from '@lib/shared/admin-auth';
import { mapMockAttemptError } from '@lib/mocks/mock-attempt-error-mapper';
import { buildListeningSourceServices } from '../services/mocks/listening-source-composition';
import type {
  ImportListeningSourceInput,
  ImportListeningItemInput,
} from '../services/mocks/import-listening-source.service';
import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

interface ImportServicePort {
  execute(input: ImportListeningSourceInput): Promise<ListeningSourceSafeDto>;
}
interface ListServicePort {
  execute(): Promise<ListeningSourceSafeDto[]>;
}

interface AdminListeningSourcesControllerDeps {
  services: () => Promise<{ importSource: ImportServicePort; listSources: ListServicePort }>;
}

const DEFAULT_DEPS: AdminListeningSourcesControllerDeps = {
  services: buildListeningSourceServices,
};

// ── POST /admin/listening-sources ───────────────────────────────────────────
// Admin-only, internal tooling endpoint — no public UI consumes this yet.
// See docs on ListeningSource: an admin registers a real official YouTube
// Listening test's video id + per-part timestamps together with that test's
// real published questions/answer key. Nothing here is AI-generated.

interface ImportListeningSourceRequestBody {
  paperCode?: unknown;
  partCode?: unknown;
  title?: unknown;
  instructions?: unknown;
  targetLevel?: unknown;
  videoExternalId?: unknown;
  videoStartSeconds?: unknown;
  videoEndSeconds?: unknown;
  items?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItems(raw: unknown): ImportListeningItemInput[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ImportListeningItemInput[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return null;
    items.push({
      position: entry.position as number,
      prompt: entry.prompt as string,
      options: (entry.options ?? null) as ImportListeningItemInput['options'],
      answerKey: entry.answerKey as ImportListeningItemInput['answerKey'],
      explanation: (entry.explanation ?? null) as string | null,
      skillTags: Array.isArray(entry.skillTags) ? (entry.skillTags as string[]) : [],
    });
  }
  return items;
}

async function importListeningSourceHandler(
  event: APIGatewayProxyEvent,
  deps: AdminListeningSourcesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedAdminPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: ImportListeningSourceRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as ImportListeningSourceRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  const items = parseItems(body.items);
  if (items === null) return errorResponse('items must be an array of objects', 400);

  try {
    const { importSource } = await deps.services();
    const result = await importSource.execute({
      paperCode: (body.paperCode ?? '') as string,
      partCode: (body.partCode ?? '') as string,
      title: (body.title ?? '') as string,
      instructions: (body.instructions ?? '') as string,
      targetLevel: (body.targetLevel ?? null) as ImportListeningSourceInput['targetLevel'],
      videoExternalId: (body.videoExternalId ?? '') as string,
      videoStartSeconds: body.videoStartSeconds as number,
      videoEndSeconds: body.videoEndSeconds as number,
      items,
    });
    return successResponse({ success: true, data: result }, 201);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function importListeningSource(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return importListeningSourceHandler(event, DEFAULT_DEPS);
}

// ── GET /admin/listening-sources ────────────────────────────────────────────

async function listListeningSourcesHandler(
  event: APIGatewayProxyEvent,
  deps: AdminListeningSourcesControllerDeps,
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

export async function listListeningSources(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return listListeningSourcesHandler(event, DEFAULT_DEPS);
}

export { importListeningSourceHandler, listListeningSourcesHandler };
export type { AdminListeningSourcesControllerDeps };
