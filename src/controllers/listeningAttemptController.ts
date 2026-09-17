import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapListeningAttemptError } from '@lib/listening/listening-attempt-error-mapper';
import { buildListeningAttemptServices } from '../services/listening/listening-attempt-composition';
import type { ListeningSourceSafeDto } from '../repositories/mocks/listening-sources.repository';
import type {
  ListeningAttemptStartResultDto,
  ListeningAttemptViewDto,
  ListeningAttemptSubmitResultDto,
} from '../interfaces/listening/listening-attempt.interface';

type NowProvider = () => Date;

interface ListSourcesPort {
  execute(): Promise<ListeningSourceSafeDto[]>;
}

interface GetSourcePort {
  execute(sourceId: string): Promise<ListeningSourceSafeDto>;
}

interface StartAttemptPort {
  execute(
    userId: string,
    sourceId: string,
    startedAt: Date,
  ): Promise<ListeningAttemptStartResultDto>;
}

interface SubmitAttemptPort {
  execute(
    userId: string,
    attemptId: string,
    rawAnswers: unknown,
    submittedAt: Date,
  ): Promise<ListeningAttemptSubmitResultDto>;
}

interface GetAttemptPort {
  execute(userId: string, attemptId: string): Promise<ListeningAttemptViewDto>;
}

interface ListeningAttemptControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    listSources: ListSourcesPort;
    getSource: GetSourcePort;
    startAttempt: StartAttemptPort;
    submitAttempt: SubmitAttemptPort;
    getAttempt: GetAttemptPort;
  }>;
}

const DEFAULT_DEPS: ListeningAttemptControllerDeps = {
  now: () => new Date(),
  services: buildListeningAttemptServices,
};

function getSourceIdParam(event: APIGatewayProxyEvent): string | null {
  const sourceId = event.pathParameters?.sourceId ?? '';
  return sourceId && isValidUuid(sourceId) ? sourceId : null;
}

function getAttemptIdParam(event: APIGatewayProxyEvent): string | null {
  const attemptId = event.pathParameters?.attemptId ?? '';
  return attemptId && isValidUuid(attemptId) ? attemptId : null;
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

// ── GET /listening/sources ────────────────────────────────────────────────────

async function listListeningSourcesHandler(
  event: APIGatewayProxyEvent,
  deps: ListeningAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { listSources } = await deps.services();
    const sources = await listSources.execute();
    return successResponse({ success: true, data: { sources } }, 200);
  } catch (err: unknown) {
    return handleError(mapListeningAttemptError(err));
  }
}

export async function listListeningSources(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return listListeningSourcesHandler(event, DEFAULT_DEPS);
}

// ── GET /listening/sources/{sourceId} ───────────────────────────────────────

async function getListeningSourceHandler(
  event: APIGatewayProxyEvent,
  deps: ListeningAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const sourceId = getSourceIdParam(event);
  if (sourceId === null) return errorResponse('Invalid or missing sourceId', 400);

  try {
    const { getSource } = await deps.services();
    const source = await getSource.execute(sourceId);
    return successResponse({ success: true, data: { source } }, 200);
  } catch (err: unknown) {
    return handleError(mapListeningAttemptError(err));
  }
}

export async function getListeningSource(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getListeningSourceHandler(event, DEFAULT_DEPS);
}

// ── POST /listening/sources/{sourceId}/attempts ───────────────────────────────

async function startListeningAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: ListeningAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const sourceId = getSourceIdParam(event);
  if (sourceId === null) return errorResponse('Invalid or missing sourceId', 400);

  try {
    const { startAttempt } = await deps.services();
    const { view } = await startAttempt.execute(payload.sub, sourceId, deps.now());
    return successResponse({ success: true, data: view }, 201);
  } catch (err: unknown) {
    return handleError(mapListeningAttemptError(err));
  }
}

export async function startListeningAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startListeningAttemptHandler(event, DEFAULT_DEPS);
}

// ── POST /listening/attempts/{attemptId}/submit ───────────────────────────────

async function submitListeningAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: ListeningAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  let body: { answers?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}') as { answers?: unknown };
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { submitAttempt } = await deps.services();
    const { result, idempotentReplay } = await submitAttempt.execute(
      payload.sub,
      attemptId,
      body.answers,
      deps.now(),
    );
    return successResponse({ success: true, data: { ...result, idempotentReplay } }, 200);
  } catch (err: unknown) {
    return handleError(mapListeningAttemptError(err));
  }
}

export async function submitListeningAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return submitListeningAttemptHandler(event, DEFAULT_DEPS);
}

// ── GET /listening/attempts/{attemptId} ────────────────────────────────────────

async function getListeningAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: ListeningAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  try {
    const { getAttempt } = await deps.services();
    const view = await getAttempt.execute(payload.sub, attemptId);
    return successResponse({ success: true, data: view }, 200);
  } catch (err: unknown) {
    return handleError(mapListeningAttemptError(err));
  }
}

export async function getListeningAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getListeningAttemptHandler(event, DEFAULT_DEPS);
}

export {
  listListeningSourcesHandler,
  getListeningSourceHandler,
  startListeningAttemptHandler,
  submitListeningAttemptHandler,
  getListeningAttemptHandler,
};
export type {
  ListeningAttemptControllerDeps,
  NowProvider,
  ListSourcesPort,
  GetSourcePort,
  StartAttemptPort,
  SubmitAttemptPort,
  GetAttemptPort,
};
