import { getDatabaseConnection } from '@lib/shared/database';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { MistakeMasteryRepository } from '@repositories/mistakes/mistake-mastery.repository';
import { getUserTimeZone } from '../planning/resolve-user-local-day';
import { ListMistakesService } from './list-mistakes.service';
import { ListWeaknessesService } from './list-weaknesses.service';

interface MistakesServices {
  listMistakes: ListMistakesService;
  listWeaknesses: ListWeaknessesService;
}

/**
 * Read side only. The write side (RecordPracticeMistakesService) is composed
 * inside SubmitPracticeAttemptService, because it must run on that
 * submission's own transactional EntityManager — never on a fresh
 * DataSource.
 */
async function buildMistakesServices(): Promise<MistakesServices> {
  const dataSource = await getDatabaseConnection();

  return {
    listMistakes: new ListMistakesService({
      repository: new MistakesRepository(dataSource),
    }),
    listWeaknesses: new ListWeaknessesService({
      repository: new MistakeMasteryRepository(dataSource),
      // Reuses the Progress/Planning rule for "the user's own day" rather
      // than a second notion of it: an unset or invalid stored zone is UTC.
      resolveTimeZone: (userId) => getUserTimeZone(dataSource, userId),
    }),
  };
}

export { buildMistakesServices };
export type { MistakesServices };
