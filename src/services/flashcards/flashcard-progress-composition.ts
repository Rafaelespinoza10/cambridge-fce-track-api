import { getDatabaseConnection } from '@lib/shared/database';
import { FlashcardProgressService } from './flashcard-progress.service';

interface FlashcardProgressServices {
  progress: FlashcardProgressService;
}

async function buildFlashcardProgressServices(): Promise<FlashcardProgressServices> {
  const dataSource = await getDatabaseConnection();
  return { progress: new FlashcardProgressService(dataSource) };
}

export { buildFlashcardProgressServices };
export type { FlashcardProgressServices };
