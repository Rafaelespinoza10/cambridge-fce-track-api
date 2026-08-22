import { getDatabaseConnection } from '@lib/shared/database';
import { ListeningSourcesRepository } from '@repositories/mocks/listening-sources.repository';
import { ImportListeningSourceService } from './import-listening-source.service';
import { ListListeningSourcesService } from './list-listening-sources.service';

interface ListeningSourceServices {
  importSource: ImportListeningSourceService;
  listSources: ListListeningSourcesService;
}

async function buildListeningSourceServices(): Promise<ListeningSourceServices> {
  const dataSource = await getDatabaseConnection();
  const repository = new ListeningSourcesRepository(dataSource);

  return {
    importSource: new ImportListeningSourceService(dataSource),
    listSources: new ListListeningSourcesService({ repository }),
  };
}

export { buildListeningSourceServices };
export type { ListeningSourceServices };
