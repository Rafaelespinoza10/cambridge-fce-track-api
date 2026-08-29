import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapMistakeError } from '@lib/mistakes/mistake-error-mapper';
import { mapGeneratePracticeExerciseError } from '@lib/practice/generate-practice-exercise-error-mapper';
import { buildMistakesServices } from '../services/mistakes/mistakes-composition';
import { buildClassifyMistakesServices } from '../services/mistakes/classify-mistakes-composition';
import { buildMistakePracticeGenerationServices } from '../services/practice/generate-mistake-practice-composition';
import { buildMistakeRemixGenerationServices } from '../services/practice/generate-mistake-remix-composition';
import type { ListMistakesRawQuery } from '../services/mistakes/list-mistakes.service';
import type { ListWeaknessesRawQuery } from '../services/mistakes/list-weaknesses.service';
import type { ListReviewsRawQuery } from '../services/mistakes/list-due-reviews.service';
import type { ListMistakesResponseDto } from '../interfaces/mistakes/mistakes.interface';
import type { ListWeaknessesResponseDto } from '../interfaces/mistakes/weaknesses.interface';
import type { ListReviewsResponseDto } from '../interfaces/mistakes/reviews.interface';
import type { ClassifyPendingMistakesResult } from '../services/mistakes/classify-pending-mistakes.service';
import type { GenerateMistakePracticeRequest } from '../interfaces/practice/practice-mistake-generation.interface';
import type { GenerateMistakeRemixRequest } from '../interfaces/practice/practice-mistake-remix.interface';
import type { PracticeExerciseSafeWithItems } from '../interfaces/practice/practice-exercise.interface';

interface ListMistakesPort {
  execute(userId: string, rawQuery: ListMistakesRawQuery): Promise<ListMistakesResponseDto>;
}

interface ListWeaknessesPort {
  execute(userId: string, rawQuery: ListWeaknessesRawQuery): Promise<ListWeaknessesResponseDto>;
}

interface ListDueReviewsPort {
  execute(userId: string, rawQuery: ListReviewsRawQuery): Promise<ListReviewsResponseDto>;
}

interface ClassifyPendingMistakesPort {
  execute(userId: string): Promise<ClassifyPendingMistakesResult>;
}

interface GenerateMistakePracticePort {
  execute(
    userId: string,
    idempotencyKey: string,
    input: GenerateMistakePracticeRequest,
  ): Promise<PracticeExerciseSafeWithItems>;
}

interface GenerateMistakeRemixPort {
  execute(
    userId: string,
    idempotencyKey: string,
    input: GenerateMistakeRemixRequest,
  ): Promise<PracticeExerciseSafeWithItems>;
}

interface MistakesControllerDeps {
  services: () => Promise<{
    listMistakes: ListMistakesPort;
    listWeaknesses: ListWeaknessesPort;
    listDueReviews: ListDueReviewsPort;
  }>;
  generationServices: () => Promise<{ generateMistakePractice: GenerateMistakePracticePort }>;
  remixGenerationServices: () => Promise<{ generateMistakeRemix: GenerateMistakeRemixPort }>;
  classifyServices: () => Promise<{ classifyPendingMistakes: ClassifyPendingMistakesPort }>;
}

const DEFAULT_DEPS: MistakesControllerDeps = {
  services: buildMistakesServices,
  generationServices: buildMistakePracticeGenerationServices,
  remixGenerationServices: buildMistakeRemixGenerationServices,
  classifyServices: buildClassifyMistakesServices,
};

// ── GET /practice/mistakes ───────────────────────────────────────────────────

/**
 * Reads only the filters this endpoint supports. A client-sent `userId` is
 * structurally impossible to honour — it is never read here, and the service
 * takes the id from the verified JWT instead.
 */
function getListQueryParams(event: APIGatewayProxyEvent): ListMistakesRawQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    skill: qs['skill'],
    examCode: qs['examCode'],
    paperCode: qs['paperCode'],
    partCode: qs['partCode'],
    errorType: qs['errorType'],
    baseWord: qs['baseWord'],
    page: qs['page'],
    pageSize: qs['pageSize'],
  };
}

async function listMistakesHandler(
  event: APIGatewayProxyEvent,
  deps: MistakesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { listMistakes } = await deps.services();
    const result = await listMistakes.execute(payload.sub, getListQueryParams(event));
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMistakeError(err));
  }
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so the exported entry point takes just `event` and wires in DEFAULT_DEPS
// itself — `deps` is only ever supplied by tests.
export async function listMistakes(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listMistakesHandler(event, DEFAULT_DEPS);
}

// ── POST /practice/mistakes/generate ─────────────────────────────────────────

interface GenerateMistakePracticeBody {
  mode?: unknown;
  mistakeConceptIds?: unknown;
  questionCount?: unknown;
  idempotencyKey?: unknown;
}

/**
 * Only these 3 fields are ever forwarded to the service — a client-supplied
 * userId (there isn't one in this body shape, but this mirrors
 * practiceExerciseController's own comment) can never be honoured, and any
 * malformed field is passed through as `unknown` for the service's own
 * runtime validation to reject with INVALID_INPUT.
 */
function toGenerateMistakePracticeRequest(
  body: GenerateMistakePracticeBody,
): GenerateMistakePracticeRequest {
  return {
    mode: body.mode === 'weaknesses' ? 'weaknesses' : undefined,
    mistakeConceptIds: Array.isArray(body.mistakeConceptIds)
      ? (body.mistakeConceptIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined,
    questionCount: typeof body.questionCount === 'number' ? body.questionCount : undefined,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '',
  };
}

async function generateMistakePracticeHandler(
  event: APIGatewayProxyEvent,
  deps: MistakesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GenerateMistakePracticeBody;
  try {
    body = JSON.parse(event.body ?? '{}') as GenerateMistakePracticeBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { generateMistakePractice } = await deps.generationServices();
    const request = toGenerateMistakePracticeRequest(body);
    const exercise = await generateMistakePractice.execute(
      payload.sub,
      request.idempotencyKey,
      request,
    );
    return successResponse({ success: true, data: exercise }, 201);
  } catch (err: unknown) {
    return handleError(mapGeneratePracticeExerciseError(err));
  }
}

export async function generateMistakePractice(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateMistakePracticeHandler(event, DEFAULT_DEPS);
}

// ── GET /practice/weaknesses ─────────────────────────────────────────────────

/** Same rule as the mistakes listing: a client-sent `userId` is never read. */
function getWeaknessesQueryParams(event: APIGatewayProxyEvent): ListWeaknessesRawQuery {
  const qs = event.queryStringParameters ?? {};
  return {
    skill: qs['skill'],
    examCode: qs['examCode'],
    paperCode: qs['paperCode'],
    partCode: qs['partCode'],
    errorType: qs['errorType'],
    errorSubtype: qs['errorSubtype'],
    status: qs['status'],
  };
}

async function listWeaknessesHandler(
  event: APIGatewayProxyEvent,
  deps: MistakesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { listWeaknesses } = await deps.services();
    const result = await listWeaknesses.execute(payload.sub, getWeaknessesQueryParams(event));
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMistakeError(err));
  }
}

export async function listWeaknesses(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listWeaknessesHandler(event, DEFAULT_DEPS);
}

// ── POST /practice/mistakes/remix ────────────────────────────────────────────

interface GenerateMistakeRemixBody {
  questionCount?: unknown;
  idempotencyKey?: unknown;
}

/**
 * All weakness selection happens server-side from the JWT user — this body
 * carries no `mistakeConceptIds`/`userId` at all, unlike
 * /practice/mistakes/generate, so there is nothing here for a client to
 * spoof its way into targeting.
 */
function toGenerateMistakeRemixRequest(
  body: GenerateMistakeRemixBody,
): GenerateMistakeRemixRequest {
  return {
    questionCount: typeof body.questionCount === 'number' ? body.questionCount : undefined,
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '',
  };
}

async function generateMistakeRemixHandler(
  event: APIGatewayProxyEvent,
  deps: MistakesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GenerateMistakeRemixBody;
  try {
    body = JSON.parse(event.body ?? '{}') as GenerateMistakeRemixBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { generateMistakeRemix } = await deps.remixGenerationServices();
    const request = toGenerateMistakeRemixRequest(body);
    const exercise = await generateMistakeRemix.execute(
      payload.sub,
      request.idempotencyKey,
      request,
    );
    return successResponse({ success: true, data: exercise }, 201);
  } catch (err: unknown) {
    return handleError(mapGeneratePracticeExerciseError(err));
  }
}

export async function generateMistakeRemix(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateMistakeRemixHandler(event, DEFAULT_DEPS);
}

// ── GET /practice/reviews ────────────────────────────────────────────────────

/** Same rule as every other listing here: a client-sent `userId` is never read. */
function getReviewsQueryParams(event: APIGatewayProxyEvent): ListReviewsRawQuery {
  const qs = event.queryStringParameters ?? {};
  return { status: qs['status'] };
}

async function listDueReviewsHandler(
  event: APIGatewayProxyEvent,
  deps: MistakesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { listDueReviews } = await deps.services();
    const result = await listDueReviews.execute(payload.sub, getReviewsQueryParams(event));
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMistakeError(err));
  }
}

export async function listDueReviews(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listDueReviewsHandler(event, DEFAULT_DEPS);
}

// ── POST /practice/mistakes/classify ─────────────────────────────────────────

/**
 * Second-pass AI classification of the mistakes no rule could read (Multiple
 * Choice Cloze). Deliberately its own request rather than part of the submit:
 * an LLM call must never hold a grading transaction open, and a submission
 * must never fail because a classification did.
 *
 * Idempotent by construction — only concepts still marked `unknown` are ever
 * written — so a client may call it after any submit without tracking whether
 * it already did.
 */
async function classifyPendingMistakesHandler(
  event: APIGatewayProxyEvent,
  deps: MistakesControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { classifyPendingMistakes } = await deps.classifyServices();
    // No request body is ever read — a client cannot choose whose mistakes
    // get classified, nor how many.
    const result = await classifyPendingMistakes.execute(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapMistakeError(err));
  }
}

export async function classifyPendingMistakes(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return classifyPendingMistakesHandler(event, DEFAULT_DEPS);
}

export {
  listMistakesHandler,
  listWeaknessesHandler,
  listDueReviewsHandler,
  classifyPendingMistakesHandler,
  generateMistakePracticeHandler,
  generateMistakeRemixHandler,
};
export type {
  MistakesControllerDeps,
  ListMistakesPort,
  ListWeaknessesPort,
  ListDueReviewsPort,
  ClassifyPendingMistakesPort,
  GenerateMistakePracticePort,
  GenerateMistakeRemixPort,
};
