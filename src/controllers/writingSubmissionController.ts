import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapWritingSubmissionError } from '@lib/writing-submission-error-mapper';
import { buildWritingSubmissionServices } from '../services/writing/writing-submission-composition';
import type {
  WritingSubmissionStartResultDto,
  WritingSubmissionViewDto,
  WritingSubmissionSubmitResultDto,
} from '../interfaces/writing/writing-submission.interface';
import type { WritingSubmissionSafeDto } from '../interfaces/writing/writing-submission.interface';
import type { WritingCorrectionFlashcardDraftResponse } from '../interfaces/writing/writing-correction-flashcard-draft.interface';
import type { WritingSubmissionHistoryResponseDto } from '../interfaces/writing/writing-submission-history.interface';
import type { ListWritingSubmissionHistoryRawQuery } from '../services/writing/list-writing-submission-history.service';

type NowProvider = () => Date;

interface StartSubmissionPort {
  execute(
    userId: string,
    taskId: string,
    startedAt: Date,
    planDayId?: string | null,
  ): Promise<WritingSubmissionStartResultDto>;
}

interface GetActiveSubmissionPort {
  execute(userId: string): Promise<WritingSubmissionViewDto | { submission: null }>;
}

interface GetSubmissionPort {
  execute(userId: string, submissionId: string): Promise<WritingSubmissionViewDto>;
}

interface SubmitSubmissionPort {
  execute(
    userId: string,
    submissionId: string,
    submittedText: unknown,
    submittedAt: Date,
  ): Promise<WritingSubmissionSubmitResultDto>;
}

interface AbandonSubmissionPort {
  execute(
    userId: string,
    submissionId: string,
  ): Promise<{ submission: WritingSubmissionSafeDto; idempotentReplay: boolean }>;
}

interface GenerateCorrectionFlashcardDraftPort {
  execute(
    userId: string,
    submissionId: string,
    correctionId: string,
  ): Promise<WritingCorrectionFlashcardDraftResponse>;
}

interface ListSubmissionHistoryPort {
  execute(
    userId: string,
    rawQuery: ListWritingSubmissionHistoryRawQuery,
  ): Promise<WritingSubmissionHistoryResponseDto>;
}

interface WritingSubmissionControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    startSubmission: StartSubmissionPort;
    getActiveSubmission: GetActiveSubmissionPort;
    getSubmission: GetSubmissionPort;
    submitSubmission: SubmitSubmissionPort;
    abandonSubmission: AbandonSubmissionPort;
    generateCorrectionFlashcardDraft: GenerateCorrectionFlashcardDraftPort;
    listSubmissionHistory: ListSubmissionHistoryPort;
  }>;
}

const DEFAULT_DEPS: WritingSubmissionControllerDeps = {
  now: () => new Date(),
  services: buildWritingSubmissionServices,
};

function getTaskIdParam(event: APIGatewayProxyEvent): string | null {
  const taskId = event.pathParameters?.taskId ?? '';
  return taskId && isValidUuid(taskId) ? taskId : null;
}

function getSubmissionIdParam(event: APIGatewayProxyEvent): string | null {
  const submissionId = event.pathParameters?.submissionId ?? '';
  return submissionId && isValidUuid(submissionId) ? submissionId : null;
}

// Corrections are entries inside a submission's `feedback` JSONB blob, not
// their own DB rows — the id is a small array-index string ("0", "1", ...),
// never a UUID.
function getCorrectionIdParam(event: APIGatewayProxyEvent): string | null {
  const correctionId = event.pathParameters?.correctionId ?? '';
  return /^\d+$/.test(correctionId) ? correctionId : null;
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

// ── POST /writing/tasks/{taskId}/submissions ────────────────────────────────────

async function startWritingSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const taskId = getTaskIdParam(event);
  if (taskId === null) return errorResponse('Invalid or missing taskId', 400);

  let body: { planDayId?: string };
  try {
    body = JSON.parse(event.body ?? '{}') as { planDayId?: string };
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const planDayId =
    typeof body.planDayId === 'string' && isValidUuid(body.planDayId) ? body.planDayId : null;

  try {
    const { startSubmission } = await deps.services();
    const { view, resumed } = await startSubmission.execute(
      payload.sub,
      taskId,
      deps.now(),
      planDayId,
    );
    return successResponse({ success: true, data: { ...view, resumed } }, resumed ? 200 : 201);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function startWritingSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startWritingSubmissionHandler(event, DEFAULT_DEPS);
}

// ── GET /writing/submissions/active ─────────────────────────────────────────────

async function getActiveWritingSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { getActiveSubmission } = await deps.services();
    const view = await getActiveSubmission.execute(payload.sub);
    const data = view.submission === null ? { submission: null } : view;
    return successResponse({ success: true, data }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function getActiveWritingSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getActiveWritingSubmissionHandler(event, DEFAULT_DEPS);
}

// ── GET /writing/submissions/{submissionId} ─────────────────────────────────────

async function getWritingSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const submissionId = getSubmissionIdParam(event);
  if (submissionId === null) return errorResponse('Invalid or missing submissionId', 400);

  try {
    const { getSubmission } = await deps.services();
    const view = await getSubmission.execute(payload.sub, submissionId);
    return successResponse({ success: true, data: view }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function getWritingSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getWritingSubmissionHandler(event, DEFAULT_DEPS);
}

// ── POST /writing/submissions/{submissionId}/submit ─────────────────────────────

async function submitWritingSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const submissionId = getSubmissionIdParam(event);
  if (submissionId === null) return errorResponse('Invalid or missing submissionId', 400);

  let body: { submittedText?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}') as { submittedText?: unknown };
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { submitSubmission } = await deps.services();
    const { result, idempotentReplay } = await submitSubmission.execute(
      payload.sub,
      submissionId,
      body.submittedText,
      deps.now(),
    );
    return successResponse({ success: true, data: { ...result, idempotentReplay } }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function submitWritingSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return submitWritingSubmissionHandler(event, DEFAULT_DEPS);
}

// ── POST /writing/submissions/{submissionId}/abandon ────────────────────────────

async function abandonWritingSubmissionHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const submissionId = getSubmissionIdParam(event);
  if (submissionId === null) return errorResponse('Invalid or missing submissionId', 400);

  try {
    const { abandonSubmission } = await deps.services();
    const { submission, idempotentReplay } = await abandonSubmission.execute(
      payload.sub,
      submissionId,
    );
    return successResponse({ success: true, data: { submission, idempotentReplay } }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function abandonWritingSubmission(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return abandonWritingSubmissionHandler(event, DEFAULT_DEPS);
}

// ── POST /writing/submissions/{submissionId}/corrections/{correctionId}/flashcard-draft ──

async function generateWritingCorrectionFlashcardDraftHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const submissionId = getSubmissionIdParam(event);
  if (submissionId === null) return errorResponse('Invalid or missing submissionId', 400);

  const correctionId = getCorrectionIdParam(event);
  if (correctionId === null) return errorResponse('Invalid or missing correctionId', 400);

  try {
    const { generateCorrectionFlashcardDraft } = await deps.services();
    // No request body is ever read — any client-sent fields are structurally ignored.
    const result = await generateCorrectionFlashcardDraft.execute(
      payload.sub,
      submissionId,
      correctionId,
    );
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function generateWritingCorrectionFlashcardDraft(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateWritingCorrectionFlashcardDraftHandler(event, DEFAULT_DEPS);
}

// ── GET /writing/submissions ──────────────────────────────────────────────────

async function listWritingSubmissionHistoryHandler(
  event: APIGatewayProxyEvent,
  deps: WritingSubmissionControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const params = event.queryStringParameters ?? {};

  try {
    const { listSubmissionHistory } = await deps.services();
    const result = await listSubmissionHistory.execute(payload.sub, {
      status: params.status,
      page: params.page,
      pageSize: params.pageSize,
    });
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingSubmissionError(err));
  }
}

export async function listWritingSubmissionHistory(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return listWritingSubmissionHistoryHandler(event, DEFAULT_DEPS);
}

export {
  startWritingSubmissionHandler,
  getActiveWritingSubmissionHandler,
  getWritingSubmissionHandler,
  submitWritingSubmissionHandler,
  abandonWritingSubmissionHandler,
  generateWritingCorrectionFlashcardDraftHandler,
  listWritingSubmissionHistoryHandler,
};
export type {
  WritingSubmissionControllerDeps,
  NowProvider,
  StartSubmissionPort,
  GetActiveSubmissionPort,
  GetSubmissionPort,
  SubmitSubmissionPort,
  AbandonSubmissionPort,
  GenerateCorrectionFlashcardDraftPort,
  ListSubmissionHistoryPort,
};
