import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapMockAttemptError } from '@lib/mocks/mock-attempt-error-mapper';
import { buildMockAttemptServices } from '../services/mocks/mock-attempt-composition';
import { ExamType } from '../models/enums';
import type {
  MockAttemptSafeDto,
  MockAttemptStartResultDto,
  StartMockAttemptSectionResultDto,
  MockAttemptSectionResultDto,
  MockAttemptFinalResultDto,
  SubmitMockAttemptSectionRequest,
  SubmitObjectiveSectionAnswerInput,
} from '../interfaces/mocks/mock-attempt.interface';

type NowProvider = () => Date;

interface StartAttemptPort {
  execute(userId: string, examType: ExamType, startedAt: Date): Promise<MockAttemptStartResultDto>;
}
interface GetActiveAttemptPort {
  execute(userId: string): Promise<{ attempt: MockAttemptSafeDto | null }>;
}
interface GetAttemptPort {
  execute(userId: string, attemptId: string): Promise<MockAttemptSafeDto>;
}
interface StartSectionPort {
  execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
  ): Promise<StartMockAttemptSectionResultDto>;
}
interface SubmitSectionPort {
  execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    request: SubmitMockAttemptSectionRequest,
    submittedAt: Date,
  ): Promise<MockAttemptSectionResultDto>;
}
interface SubmitAttemptPort {
  execute(userId: string, attemptId: string, submittedAt: Date): Promise<MockAttemptFinalResultDto>;
}
interface AbandonAttemptPort {
  execute(
    userId: string,
    attemptId: string,
  ): Promise<{ attempt: MockAttemptSafeDto; idempotentReplay: boolean }>;
}

interface MockAttemptsControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    startAttempt: StartAttemptPort;
    getActiveAttempt: GetActiveAttemptPort;
    getAttempt: GetAttemptPort;
    startSection: StartSectionPort;
    submitSection: SubmitSectionPort;
    submitAttempt: SubmitAttemptPort;
    abandonAttempt: AbandonAttemptPort;
  }>;
}

const DEFAULT_DEPS: MockAttemptsControllerDeps = {
  now: () => new Date(),
  services: buildMockAttemptServices,
};

function getAttemptIdParam(event: APIGatewayProxyEvent): string | null {
  const attemptId = event.pathParameters?.attemptId ?? '';
  return attemptId && isValidUuid(attemptId) ? attemptId : null;
}

function getSectionCodeParam(event: APIGatewayProxyEvent): string | null {
  const sectionCode = event.pathParameters?.sectionCode ?? '';
  return sectionCode.trim() !== '' ? sectionCode : null;
}

// Each handler below takes `deps` explicitly (only ever supplied by tests);
// the exported Lambda entry point takes just `event` and always wires in
// DEFAULT_DEPS itself — same shape as every other controller in this codebase.

// ── POST /mocks/attempts ──────────────────────────────────────────────────────

async function startMockAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: { examType?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}') as { examType?: unknown };
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const examType =
    typeof body.examType === 'string' && (Object.values(ExamType) as string[]).includes(body.examType)
      ? (body.examType as ExamType)
      : ExamType.B2_FIRST;

  try {
    const { startAttempt } = await deps.services();
    const { attempt, resumed } = await startAttempt.execute(payload.sub, examType, deps.now());
    return successResponse({ success: true, data: { attempt, resumed } }, resumed ? 200 : 201);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function startMockAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startMockAttemptHandler(event, DEFAULT_DEPS);
}

// ── GET /mocks/attempts/active ────────────────────────────────────────────────

async function getActiveMockAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { getActiveAttempt } = await deps.services();
    const result = await getActiveAttempt.execute(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function getActiveMockAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getActiveMockAttemptHandler(event, DEFAULT_DEPS);
}

// ── GET /mocks/attempts/{attemptId} ───────────────────────────────────────────

async function getMockAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  try {
    const { getAttempt } = await deps.services();
    const attempt = await getAttempt.execute(payload.sub, attemptId);
    return successResponse({ success: true, data: { attempt } }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function getMockAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getMockAttemptHandler(event, DEFAULT_DEPS);
}

// ── POST /mocks/attempts/{attemptId}/sections/{sectionCode}/start ────────────

async function startMockAttemptSectionHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);
  const sectionCode = getSectionCodeParam(event);
  if (sectionCode === null) return errorResponse('Invalid or missing sectionCode', 400);

  try {
    const { startSection } = await deps.services();
    const result = await startSection.execute(payload.sub, attemptId, sectionCode);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function startMockAttemptSection(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startMockAttemptSectionHandler(event, DEFAULT_DEPS);
}

// ── POST /mocks/attempts/{attemptId}/sections/{sectionCode}/submit ───────────

interface SubmitSectionRequestBody {
  answers?: unknown;
  content?: unknown;
}

function parseSubmitSectionRequest(
  body: SubmitSectionRequestBody,
): SubmitMockAttemptSectionRequest | null {
  if (typeof body.content === 'string') return { content: body.content };
  if (Array.isArray(body.answers)) {
    // Shape-validated downstream by isMockAttemptObjectiveAnswer inside
    // SubmitMockAttemptSectionService — the controller only checks "is this
    // even an array", never the answer key details themselves.
    return { answers: body.answers as SubmitObjectiveSectionAnswerInput[] };
  }
  return null;
}

async function submitMockAttemptSectionHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);
  const sectionCode = getSectionCodeParam(event);
  if (sectionCode === null) return errorResponse('Invalid or missing sectionCode', 400);

  let body: SubmitSectionRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as SubmitSectionRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const request = parseSubmitSectionRequest(body);
  if (request === null) {
    return errorResponse('Request body must contain either "answers" or "content"', 400);
  }

  try {
    const { submitSection } = await deps.services();
    const result = await submitSection.execute(
      payload.sub,
      attemptId,
      sectionCode,
      request,
      deps.now(),
    );
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function submitMockAttemptSection(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return submitMockAttemptSectionHandler(event, DEFAULT_DEPS);
}

// ── POST /mocks/attempts/{attemptId}/submit ───────────────────────────────────

async function submitMockAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  try {
    const { submitAttempt } = await deps.services();
    const result = await submitAttempt.execute(payload.sub, attemptId, deps.now());
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function submitMockAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return submitMockAttemptHandler(event, DEFAULT_DEPS);
}

// ── POST /mocks/attempts/{attemptId}/abandon ──────────────────────────────────

async function abandonMockAttemptHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  try {
    const { abandonAttempt } = await deps.services();
    const result = await abandonAttempt.execute(payload.sub, attemptId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function abandonMockAttempt(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return abandonMockAttemptHandler(event, DEFAULT_DEPS);
}

export {
  startMockAttemptHandler,
  getActiveMockAttemptHandler,
  getMockAttemptHandler,
  startMockAttemptSectionHandler,
  submitMockAttemptSectionHandler,
  submitMockAttemptHandler,
  abandonMockAttemptHandler,
};
export type { MockAttemptsControllerDeps, NowProvider };
