import { getDatabaseConnection } from '@lib/shared/database';
import { DecksService } from './decks.service';

interface DecksServices {
  decks: DecksService;
}

async function buildDecksServices(): Promise<DecksServices> {
  const dataSource = await getDatabaseConnection();
  return { decks: new DecksService(dataSource) };
}

export { buildDecksServices };
export type { DecksServices };
