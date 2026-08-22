import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapDailySessionSubmissionError } from '@lib/daily-session/daily-session-submission-error-mapper';
import { buildDailySessionSubmissionServices } from '../services/daily-session/daily-session-submission-composition';
import type {
  SentenceSubmissionRequest,
  DailySessionSubmissionStartResultDto,
  DailySessionSubmissionSubmitResultDto,
} from '../interfaces/daily-session/daily-session.interface';
import type { DailySessionSubmissionViewDto } from '../services/daily-session/get-daily-session-submission.service';

type NowProvider = () => Date;

interface StartSubmissionPort {
  execute(
    userId: string,
    dailySessionId: string,
    startedAt: Date,
  ): Promise<DailySessionSubmissionStartResultDto>;
}

interface SubmitSubmissionPort {
  execute(
    userId: string,
    submissionId: string,
    input: { comprehensionAnswers: unknown; sentenceSubmissions: unknown },
    submittedAt: Date,
  ): Promise<DailySessionSubmissionSubmitResultDto>;
}

interface GetSubmissionPort {
  getSubmission(userId: string, submissionId: string): Promise<DailySessionSubmissionViewDto>;
}

interface DailySessionSubmissionControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    startSubmission: StartSubmissionPort;
    submitSubmission: SubmitSubmissionPort;
    getSubmission: GetSubmissionPort;
  }>;
}

const DEFAULT_DEPS: DailySessionSubmissionControllerDeps = {
  now: () => new Date(),
  services: buildDailySessionSubmissionServices,
};

function getSessionIdParam(event: APIGatewayProxyEvent): string | null {
  const sessionId = event.pathParameters?.sessionId ?? '';
  return sessionId && isValidUuid(sessionId) ? sessionId : null;
}

function getSubmissionIdParam(event: APIGatewayProxyEvent): string | null {
  const submissionId = event.pathParameters?.submissionId ?? '';
  return submissionId && isValidUuid(submissionId) ? submissionId : null;
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

// ── POST /daily-session/{sessionId}/submissions — get-or-create ────────────────

async function startDailySessionSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: DailySessionSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const sessionId = getSessionIdParam(event);
  if (sessionId === null) return errorResponse('Invalid or missing sessionId', 400);

  try {
    const { startSubmission } = await deps.services();
    const { submission, resumed } = await startSubmission.execute(
      payload.sub,
      sessionId,
      deps.now(),
    );
    return successResponse(
      { success: true, data: { ...submission, resumed } },
      resumed ? 200 : 201,
    );
  } catch (err: unknown) {
    return handleError(mapDailySessionSubmissionError(err));
  }
}

export async function startDailySessionSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startDailySessionSubmissionHandler(event, DEFAULT_DEPS);
}

// ── POST /daily-session/submissions/{submissionId}/submit ──────────────────────

interface SubmitDailySessionSubmissionBody {
  comprehensionAnswers?: unknown;
  sentenceSubmissions?: SentenceSubmissionRequest[];
}

async function submitDailySessionSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: DailySessionSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const submissionId = getSubmissionIdParam(event);
  if (submissionId === null) return errorResponse('Invalid or missing submissionId', 400);

  let body: SubmitDailySessionSubmissionBody;
  try {
    body = JSON.parse(event.body ?? '{}') as SubmitDailySessionSubmissionBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { submitSubmission } = await deps.services();
    const { result, idempotentReplay } = await submitSubmission.execute(
      payload.sub,
      submissionId,
      {
        comprehensionAnswers: body.comprehensionAnswers,
        sentenceSubmissions: body.sentenceSubmissions,
      },
      deps.now(),
    );
    return successResponse({ success: true, data: { ...result, idempotentReplay } }, 200);
  } catch (err: unknown) {
    return handleError(mapDailySessionSubmissionError(err));
  }
}

export async function submitDailySessionSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return submitDailySessionSubmissionHandler(event, DEFAULT_DEPS);
}

// ── GET /daily-session/submissions/{submissionId} ───────────────────────────────

async function getDailySessionSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: DailySessionSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const submissionId = getSubmissionIdParam(event);
  if (submissionId === null) return errorResponse('Invalid or missing submissionId', 400);

  try {
    const { getSubmission } = await deps.services();
    const view = await getSubmission.getSubmission(payload.sub, submissionId);
    return successResponse({ success: true, data: view }, 200);
  } catch (err: unknown) {
    return handleError(mapDailySessionSubmissionError(err));
  }
}

export async function getDailySessionSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getDailySessionSubmissionHandler(event, DEFAULT_DEPS);
}

export {
  startDailySessionSubmissionHandler,
  submitDailySessionSubmissionHandler,
  getDailySessionSubmissionHandler,
};
export type {
  DailySessionSubmissionControllerDeps,
  NowProvider,
  StartSubmissionPort,
  SubmitSubmissionPort,
  GetSubmissionPort,
};
