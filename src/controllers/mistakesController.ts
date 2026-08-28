import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapMistakeError } from '@lib/mistakes/mistake-error-mapper';
import { mapGeneratePracticeExerciseError } from '@lib/practice/generate-practice-exercise-error-mapper';
import { buildMistakesServices } from '../services/mistakes/mistakes-composition';
import { buildMistakePracticeGenerationServices } from '../services/practice/generate-mistake-practice-composition';
import type { ListMistakesRawQuery } from '../services/mistakes/list-mistakes.service';
import type { ListMistakesResponseDto } from '../interfaces/mistakes/mistakes.interface';
import type { GenerateMistakePracticeRequest } from '../interfaces/practice/practice-mistake-generation.interface';
import type { PracticeExerciseSafeWithItems } from '../interfaces/practice/practice-exercise.interface';

interface ListMistakesPort {
  execute(userId: string, rawQuery: ListMistakesRawQuery): Promise<ListMistakesResponseDto>;
}

interface GenerateMistakePracticePort {
  execute(
    userId: string,
    idempotencyKey: string,
    input: GenerateMistakePracticeRequest,
  ): Promise<PracticeExerciseSafeWithItems>;
}

interface MistakesControllerDeps {
  services: () => Promise<{ listMistakes: ListMistakesPort }>;
  generationServices: () => Promise<{ generateMistakePractice: GenerateMistakePracticePort }>;
}

const DEFAULT_DEPS: MistakesControllerDeps = {
  services: buildMistakesServices,
  generationServices: buildMistakePracticeGenerationServices,
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

export { listMistakesHandler, generateMistakePracticeHandler };
export type { MistakesControllerDeps, ListMistakesPort, GenerateMistakePracticePort };
