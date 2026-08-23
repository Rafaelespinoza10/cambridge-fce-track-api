import { getDatabaseConnection } from '@lib/shared/database';
import { ListDailySessionHistoryService } from './list-daily-session-history.service';
import { DailySessionsRepository } from '@repositories/daily-session/daily-sessions.repository';

/**
 * Wiring for the history list only, kept apart from
 * generate-daily-session-composition.ts on purpose: that module reaches the
 * OpenAI client and the Knowledge Base search (and through it the embedding
 * client), none of which a paginated DB read needs. Keeping them out of this
 * module's graph keeps them out of this Lambda's bundle — the same reasoning
 * behind cambridge-knowledge-search-composition.ts, minus the crash.
 */

interface DailySessionHistoryServices {
  listHistory: ListDailySessionHistoryService;
}

async function buildDailySessionHistoryServices(): Promise<DailySessionHistoryServices> {
  const dataSource = await getDatabaseConnection();

  return {
    listHistory: new ListDailySessionHistoryService({
      repository: new DailySessionsRepository(dataSource),
    }),
  };
}

export { buildDailySessionHistoryServices };
export type { DailySessionHistoryServices };
