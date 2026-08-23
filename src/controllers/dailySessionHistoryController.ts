import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapListDailySessionHistoryError } from '@lib/daily-session/daily-session-history-error-mapper';
import { buildDailySessionHistoryServices } from '../services/daily-session/list-daily-session-history-composition';
import type { DailySessionHistoryResponseDto } from '../interfaces/daily-session/daily-session-history.interface';
import type { ListDailySessionHistoryRawQuery } from '../services/daily-session/list-daily-session-history.service';

/**
 * Its own controller file, not another handler in dailySessionController.ts:
 * esbuild bundles a Lambda from its whole entry module, so sharing that file
 * would pull buildDailySessionServices — and with it the OpenAI client and the
 * Knowledge Base embedding client — into this pure-DB read's bundle and cold
 * start. See list-daily-session-history-composition.ts.
 */

interface ListHistoryPort {
  execute(
    userId: string,
    rawQuery: ListDailySessionHistoryRawQuery,
  ): Promise<DailySessionHistoryResponseDto>;
}

interface DailySessionHistoryControllerDeps {
  services: () => Promise<{ listHistory: ListHistoryPort }>;
}

const DEFAULT_DEPS: DailySessionHistoryControllerDeps = {
  services: buildDailySessionHistoryServices,
};

// ── GET /daily-session — paginated history ─────────────────────────────────────
// Distinguished from POST /daily-session (generate today's) by method alone, so
// there is no route-precedence question against GET /daily-session/{sessionId}.

async function listDailySessionHistoryHandler(
  event: APIGatewayProxyEvent,
  deps: DailySessionHistoryControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const query = event.queryStringParameters ?? {};

  try {
    const { listHistory } = await deps.services();
    const history = await listHistory.execute(payload.sub, {
      page: query.page ?? undefined,
      pageSize: query.pageSize ?? undefined,
    });
    return successResponse({ success: true, data: history }, 200);
  } catch (err: unknown) {
    return handleError(mapListDailySessionHistoryError(err));
  }
}

export async function listDailySessionHistory(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return listDailySessionHistoryHandler(event, DEFAULT_DEPS);
}

export { listDailySessionHistoryHandler };
export type { DailySessionHistoryControllerDeps, ListHistoryPort };
