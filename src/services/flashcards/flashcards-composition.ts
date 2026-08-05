import { getDatabaseConnection } from '../../lib/database';
import { FlashcardsService } from './flashcards.service';

interface FlashcardsServices {
  flashcards: FlashcardsService;
}

async function buildFlashcardsServices(): Promise<FlashcardsServices> {
  const dataSource = await getDatabaseConnection();
  return { flashcards: new FlashcardsService(dataSource) };
}

export { buildFlashcardsServices };
export type { FlashcardsServices };
