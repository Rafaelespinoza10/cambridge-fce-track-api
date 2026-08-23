import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapMockAttemptError } from '@lib/mocks/mock-attempt-error-mapper';
import { buildMockAttemptServices } from '../services/mocks/mock-attempt-composition';
import { ExamType } from '../models/enums';
import type { MockAttemptScope } from '@lib/mocks/mock-attempt-catalog';
import type {
  MockAttemptSafeDto,
  MockAttemptStartResultDto,
  StartMockAttemptSectionResultDto,
  MockAttemptSectionResultDto,
  MockAttemptFinalResultDto,
  SubmitMockAttemptSectionRequest,
  SubmitObjectiveSectionAnswerInput,
  SaveMockAttemptSectionDraftRequest,
  SaveMockAttemptSectionDraftResultDto,
} from '../interfaces/mocks/mock-attempt.interface';
import type { MockAttemptSectionResultViewDto } from '../services/mocks/get-mock-attempt-section-result.service';
import type { MockAttemptResultDto } from '../services/mocks/get-mock-attempt-result.service';
import type { PracticeErrorFlashcardDraftResponse } from '../interfaces/practice/practice-error-flashcard-draft.interface';
import type { WritingCorrectionFlashcardDraftResponse } from '../interfaces/writing/writing-correction-flashcard-draft.interface';

type NowProvider = () => Date;

interface StartAttemptPort {
  execute(
    userId: string,
    examType: ExamType,
    startedAt: Date,
    scope?: MockAttemptScope,
  ): Promise<MockAttemptStartResultDto>;
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
interface GetSectionResultPort {
  execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
  ): Promise<MockAttemptSectionResultViewDto>;
}
interface SaveSectionDraftPort {
  execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    request: SaveMockAttemptSectionDraftRequest,
  ): Promise<SaveMockAttemptSectionDraftResultDto>;
}
interface GetResultPort {
  execute(userId: string, attemptId: string): Promise<MockAttemptResultDto>;
}
interface GenerateItemFlashcardDraftPort {
  execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    itemId: string,
  ): Promise<PracticeErrorFlashcardDraftResponse>;
}
interface GenerateCorrectionFlashcardDraftPort {
  execute(
    userId: string,
    attemptId: string,
    sectionCode: string,
    correctionId: string,
  ): Promise<WritingCorrectionFlashcardDraftResponse>;
}

interface MockAttemptsControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    startAttempt: StartAttemptPort;
    getActiveAttempt: GetActiveAttemptPort;
    getAttempt: GetAttemptPort;
    startSection: StartSectionPort;
    saveSectionDraft: SaveSectionDraftPort;
    submitSection: SubmitSectionPort;
    submitAttempt: SubmitAttemptPort;
    abandonAttempt: AbandonAttemptPort;
    getSectionResult: GetSectionResultPort;
    getResult: GetResultPort;
    generateItemFlashcardDraft: GenerateItemFlashcardDraftPort;
    generateCorrectionFlashcardDraft: GenerateCorrectionFlashcardDraftPort;
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

function getItemIdParam(event: APIGatewayProxyEvent): string | null {
  const itemId = event.pathParameters?.itemId ?? '';
  return itemId && isValidUuid(itemId) ? itemId : null;
}

// Matches the numeric string ids WritingFeedback.corrections actually uses
// (String(index) — see validateCorrections in lib/writing/writing-grading.ts).
function getCorrectionIdParam(event: APIGatewayProxyEvent): string | null {
  const correctionId = event.pathParameters?.correctionId ?? '';
  return /^\d+$/.test(correctionId) ? correctionId : null;
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

  let body: { examType?: unknown; scope?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}') as { examType?: unknown; scope?: unknown };
  } catch {
    return errorResponse('Invalid request body', 400);
  }
  const examType =
    typeof body.examType === 'string' &&
    (Object.values(ExamType) as string[]).includes(body.examType)
      ? (body.examType as ExamType)
      : ExamType.B2_FIRST;
  // Omitted means the whole exam, so every existing client keeps working
  // unchanged. An unrecognised value is rejected by the service rather than
  // silently widened to 'full' — asking for Listening and quietly getting all
  // 13 sections would be a nasty surprise.
  const scope = body.scope === undefined ? undefined : body.scope;

  try {
    const { startAttempt } = await deps.services();
    const { attempt, resumed } = await startAttempt.execute(
      payload.sub,
      examType,
      deps.now(),
      scope as MockAttemptScope | undefined,
    );
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

export async function getMockAttempt(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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

// ── PATCH /mocks/attempts/{attemptId}/sections/{sectionCode}/draft ───────────
// Autosaves whatever the student has typed so far in a still-open section —
// never graded, never marks the section completed. See
// SaveMockAttemptSectionDraftService's doc comment.

async function saveMockAttemptSectionDraftHandler(
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
    const { saveSectionDraft } = await deps.services();
    const result = await saveSectionDraft.execute(payload.sub, attemptId, sectionCode, request);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function saveMockAttemptSectionDraft(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return saveMockAttemptSectionDraftHandler(event, DEFAULT_DEPS);
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

// ── GET /mocks/attempts/{attemptId}/sections/{sectionCode} ────────────────────

async function getMockAttemptSectionResultHandler(
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
    const { getSectionResult } = await deps.services();
    const result = await getSectionResult.execute(payload.sub, attemptId, sectionCode);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function getMockAttemptSectionResult(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getMockAttemptSectionResultHandler(event, DEFAULT_DEPS);
}

// ── GET /mocks/attempts/{attemptId}/result ────────────────────────────────────
// Full, answer-revealing detail of one finished (completed or abandoned)
// attempt: every section's feedback plus a per-item review and the 4
// paper-level (Reading/Use of English/Writing/Listening) score rollups —
// see GetMockAttemptResultService's doc comment.

async function getMockAttemptResultHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);

  try {
    const { getResult } = await deps.services();
    const result = await getResult.execute(payload.sub, attemptId);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function getMockAttemptResult(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getMockAttemptResultHandler(event, DEFAULT_DEPS);
}

// ── POST /mocks/attempts/{attemptId}/sections/{sectionCode}/items/{itemId}/flashcard-draft ──
// Converts one incorrect objective item from a completed mock section into
// an editable flashcard draft — mirrors
// POST /practice/attempts/{attemptId}/items/{itemId}/flashcard-draft.

async function generateMockAttemptItemFlashcardDraftHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);
  const sectionCode = getSectionCodeParam(event);
  if (sectionCode === null) return errorResponse('Invalid or missing sectionCode', 400);
  const itemId = getItemIdParam(event);
  if (itemId === null) return errorResponse('Invalid or missing itemId', 400);

  try {
    const { generateItemFlashcardDraft } = await deps.services();
    // No request body is ever read — any client-sent fields are structurally ignored.
    const result = await generateItemFlashcardDraft.execute(
      payload.sub,
      attemptId,
      sectionCode,
      itemId,
    );
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function generateMockAttemptItemFlashcardDraft(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateMockAttemptItemFlashcardDraftHandler(event, DEFAULT_DEPS);
}

// ── POST /mocks/attempts/{attemptId}/sections/{sectionCode}/corrections/{correctionId}/flashcard-draft ──
// Converts one correction from a graded mock Writing section into an
// editable flashcard draft — mirrors
// POST /writing/submissions/{submissionId}/corrections/{correctionId}/flashcard-draft.

async function generateMockAttemptCorrectionFlashcardDraftHandler(
  event: APIGatewayProxyEvent,
  deps: MockAttemptsControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const attemptId = getAttemptIdParam(event);
  if (attemptId === null) return errorResponse('Invalid or missing attemptId', 400);
  const sectionCode = getSectionCodeParam(event);
  if (sectionCode === null) return errorResponse('Invalid or missing sectionCode', 400);
  const correctionId = getCorrectionIdParam(event);
  if (correctionId === null) return errorResponse('Invalid or missing correctionId', 400);

  try {
    const { generateCorrectionFlashcardDraft } = await deps.services();
    // No request body is ever read — any client-sent fields are structurally ignored.
    const result = await generateCorrectionFlashcardDraft.execute(
      payload.sub,
      attemptId,
      sectionCode,
      correctionId,
    );
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMockAttemptError(err));
  }
}

export async function generateMockAttemptCorrectionFlashcardDraft(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateMockAttemptCorrectionFlashcardDraftHandler(event, DEFAULT_DEPS);
}

export {
  startMockAttemptHandler,
  getActiveMockAttemptHandler,
  getMockAttemptHandler,
  startMockAttemptSectionHandler,
  saveMockAttemptSectionDraftHandler,
  submitMockAttemptSectionHandler,
  submitMockAttemptHandler,
  abandonMockAttemptHandler,
  getMockAttemptSectionResultHandler,
  getMockAttemptResultHandler,
  generateMockAttemptItemFlashcardDraftHandler,
  generateMockAttemptCorrectionFlashcardDraftHandler,
};
export type { MockAttemptsControllerDeps, NowProvider };
