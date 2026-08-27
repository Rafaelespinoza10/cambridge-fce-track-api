import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapMistakeError } from '@lib/mistakes/mistake-error-mapper';
import { buildMistakesServices } from '../services/mistakes/mistakes-composition';
import type { ListMistakesRawQuery } from '../services/mistakes/list-mistakes.service';
import type { ListMistakesResponseDto } from '../interfaces/mistakes/mistakes.interface';

interface ListMistakesPort {
  execute(userId: string, rawQuery: ListMistakesRawQuery): Promise<ListMistakesResponseDto>;
}

interface MistakesControllerDeps {
  services: () => Promise<{ listMistakes: ListMistakesPort }>;
}

const DEFAULT_DEPS: MistakesControllerDeps = {
  services: buildMistakesServices,
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

export { listMistakesHandler };
export type { MistakesControllerDeps, ListMistakesPort };
