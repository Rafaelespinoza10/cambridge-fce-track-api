import { getDatabaseConnection } from '@lib/shared/database';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { ListMistakesService } from './list-mistakes.service';

interface MistakesServices {
  listMistakes: ListMistakesService;
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
  };
}

export { buildMistakesServices };
export type { MistakesServices };
