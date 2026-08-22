import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapGenerateDailySessionError } from '@lib/daily-session/generate-daily-session-error-mapper';
import { buildDailySessionServices } from '../services/daily-session/generate-daily-session-composition';
import type {
  GenerateDailySessionRequest,
  DailySessionSafeWithItems,
} from '../interfaces/daily-session/daily-session.interface';

type NowProvider = () => Date;

interface GenerateSessionPort {
  execute(
    userId: string,
    requestedAt: Date,
    input: GenerateDailySessionRequest,
  ): Promise<DailySessionSafeWithItems>;
}

interface GetSessionPort {
  getSession(userId: string, sessionId: string): Promise<DailySessionSafeWithItems>;
}

interface DailySessionControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    generateSession: GenerateSessionPort;
    getSession: GetSessionPort;
  }>;
}

const DEFAULT_DEPS: DailySessionControllerDeps = {
  now: () => new Date(),
  services: buildDailySessionServices,
};

function getSessionIdParam(event: APIGatewayProxyEvent): string | null {
  const sessionId = event.pathParameters?.sessionId ?? '';
  return sessionId && isValidUuid(sessionId) ? sessionId : null;
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

// ── POST /daily-session — generate (or replay) today's session ─────────────────

async function generateDailySessionHandler(
  event: APIGatewayProxyEvent,
  deps: DailySessionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GenerateDailySessionRequest;
  try {
    body = JSON.parse(event.body ?? '{}') as GenerateDailySessionRequest;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { generateSession } = await deps.services();
    // Only targetLevel is ever forwarded — unknown fields (including a
    // client-supplied userId or sessionDate) are structurally ignored.
    const session = await generateSession.execute(payload.sub, deps.now(), {
      targetLevel: body.targetLevel,
    });
    return successResponse({ success: true, data: session }, 201);
  } catch (err: unknown) {
    return handleError(mapGenerateDailySessionError(err));
  }
}

export async function generateDailySession(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateDailySessionHandler(event, DEFAULT_DEPS);
}

// ── GET /daily-session/{sessionId} ──────────────────────────────────────────────

async function getDailySessionHandler(
  event: APIGatewayProxyEvent,
  deps: DailySessionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const sessionId = getSessionIdParam(event);
  if (sessionId === null) return errorResponse('Invalid or missing sessionId', 400);

  try {
    const { getSession } = await deps.services();
    const session = await getSession.getSession(payload.sub, sessionId);
    return successResponse({ success: true, data: session }, 200);
  } catch (err: unknown) {
    return handleError(mapGenerateDailySessionError(err));
  }
}

export async function getDailySession(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getDailySessionHandler(event, DEFAULT_DEPS);
}

export { generateDailySessionHandler, getDailySessionHandler };
export type { DailySessionControllerDeps, NowProvider, GenerateSessionPort, GetSessionPort };
