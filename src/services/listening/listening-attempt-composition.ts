import { getDatabaseConnection } from '@lib/shared/database';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import { ListeningAttemptsRepository } from '@repositories/listening/listening-attempts.repository';
import { ListActiveListeningSourcesService } from './list-active-listening-sources.service';
import { GetListeningSourceService } from './get-listening-source.service';
import { StartListeningAttemptService } from './start-listening-attempt.service';
import { SubmitListeningAttemptService } from './submit-listening-attempt.service';
import { GetListeningAttemptService } from './get-listening-attempt.service';

interface ListeningAttemptServices {
  listSources: ListActiveListeningSourcesService;
  getSource: GetListeningSourceService;
  startAttempt: StartListeningAttemptService;
  submitAttempt: SubmitListeningAttemptService;
  getAttempt: GetListeningAttemptService;
}

async function buildListeningAttemptServices(): Promise<ListeningAttemptServices> {
  const dataSource = await getDatabaseConnection();
  const sourcesRepo = new ListeningSourcesRepository(dataSource);
  const attemptsRepo = new ListeningAttemptsRepository(dataSource);

  return {
    listSources: new ListActiveListeningSourcesService({ repository: sourcesRepo }),
    getSource: new GetListeningSourceService({ repository: sourcesRepo }),
    startAttempt: new StartListeningAttemptService({
      sources: sourcesRepo,
      attempts: attemptsRepo,
    }),
    submitAttempt: new SubmitListeningAttemptService({
      attempts: attemptsRepo,
      sources: sourcesRepo,
    }),
    getAttempt: new GetListeningAttemptService({
      attempts: attemptsRepo,
      sources: sourcesRepo,
    }),
  };
}

export { buildListeningAttemptServices };
export type { ListeningAttemptServices };
