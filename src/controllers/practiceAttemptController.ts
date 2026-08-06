import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapPracticeAttemptError } from '@lib/practice-attempt-error-mapper';
import { buildPracticeAttemptServices } from '../services/practice/practice-attempt-composition';
import type {
  PracticeAttemptStartResultDto,
  PracticeAttemptViewDto,
  PracticeAttemptSubmitResultDto,
  PracticeAttemptAbandonResultDto,
} from '../interfaces/practice/practice-attempt.interface';

type NowProvider = () => Date;

interface StartAttemptPort {
  execute(
    userId: string,
    exerciseId: string,
    startedAt: Date,
  ): Promise<PracticeAttemptStartResultDto>;
}

interface GetActiveAttemptPort {
  execute(userId: string): Promise<PracticeAttemptViewDto | { attempt: null }>;
}

interface GetAttemptPort {
  execute(userId: string, attemptId: string): Promise<PracticeAttemptViewDto>;
}

interface SubmitAttemptPort {
  execute(
    userId: string,
    attemptId: string,
    rawAnswers: unknown,
    submittedAt: Date,
  ): Promise<PracticeAttemptSubmitResultDto>;
}

interface AbandonAttemptPort {
  execute(userId: string, attemptId: string): Promise<PracticeAttemptAbandonResultDto>;
}

interface PracticeAttemptControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    startAttempt: StartAttemptPort;
    getActiveAttempt: GetActiveAttemptPort;
    getAttempt: GetAttemptPort;
    submitAttempt: SubmitAttemptPort;
    abandonAttempt: AbandonAttemptPort;
  }>;
}

const DEFAULT_DEPS: PracticeAttemptControllerDeps = {
  now: () => new Date(),
  services: buildPracticeAttemptServices,
};

function getExerciseIdParam(event: APIGatewayProxyEvent): string | null {
  const exerciseId = event.pathParameters?.exerciseId ?? '';
  return exerciseId && isValidUuid(exerciseId) ? exerciseId : null;
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

// ── POST /practice/exercises/{exerciseId}/attempts ───────────────────────────

async function startPracticeAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const exerciseId = getExerciseIdParam(event);
  if (exerciseId === null) return errorResponse('Invalid or missing exerciseId', 400);

  try {
    const { startAttempt } = await deps.services();
    const { view, resumed } = await startAttempt.execute(payload.sub, exerciseId, deps.now());
    return successResponse({ success: true, data: { ...view, resumed } }, resumed ? 200 : 201);
  } catch (err: unknown) {
    return handleError(mapPracticeAttemptError(err));
  }
}

export async function startPracticeAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startPracticeAttemptHandler(event, DEFAULT_DEPS);
}

// ── GET /practice/attempts/active ─────────────────────────────────────────────

async function getActivePracticeAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { getActiveAttempt } = await deps.services();
    const view = await getActiveAttempt.execute(payload.sub);
    const data = view.attempt === null ? { attempt: null } : view;
    return successResponse({ success: true, data }, 200);
  } catch (err: unknown) {
    return handleError(mapPracticeAttemptError(err));
  }
}

export async function getActivePracticeAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getActivePracticeAttemptHandler(event, DEFAULT_DEPS);
}

// ── GET /practice/attempts/{attemptId} ────────────────────────────────────────

async function getPracticeAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeAttemptControllerDeps,
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
    return handleError(mapPracticeAttemptError(err));
  }
}

export async function getPracticeAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getPracticeAttemptHandler(event, DEFAULT_DEPS);
}

// ── POST /practice/attempts/{attemptId}/submit ────────────────────────────────

async function submitPracticeAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeAttemptControllerDeps,
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
    return handleError(mapPracticeAttemptError(err));
  }
}

export async function submitPracticeAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return submitPracticeAttemptHandler(event, DEFAULT_DEPS);
}

// ── POST /practice/attempts/{attemptId}/abandon ───────────────────────────────

async function abandonPracticeAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeAttemptControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  try {
    const { abandonAttempt } = await deps.services();
    const { attempt, idempotentReplay } = await abandonAttempt.execute(payload.sub, attemptId);
    return successResponse({ success: true, data: { attempt, idempotentReplay } }, 200);
  } catch (err: unknown) {
    return handleError(mapPracticeAttemptError(err));
  }
}

export async function abandonPracticeAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return abandonPracticeAttemptHandler(event, DEFAULT_DEPS);
}

export {
  startPracticeAttemptHandler,
  getActivePracticeAttemptHandler,
  getPracticeAttemptHandler,
  submitPracticeAttemptHandler,
  abandonPracticeAttemptHandler,
};
export type {
  PracticeAttemptControllerDeps,
  NowProvider,
  StartAttemptPort,
  GetActiveAttemptPort,
  GetAttemptPort,
  SubmitAttemptPort,
  AbandonAttemptPort,
};
