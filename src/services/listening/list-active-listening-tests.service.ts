import type { ListeningTestGroupDto } from '@lib/listening/listening-test-grouping';
import { groupListeningSourcesIntoTests } from '@lib/listening/listening-test-grouping';
import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

export interface ListActiveListeningTestsRepositoryPort {
  listActiveSources(): Promise<ListeningSourceSafeDto[]>;
}

export interface ListActiveListeningTestsServiceDeps {
  repository: ListActiveListeningTestsRepositoryPort;
}

/** User-facing catalog grouped by YouTube video (one card = one full test). */
export class ListActiveListeningTestsService {
  constructor(private readonly deps: ListActiveListeningTestsServiceDeps) {}

  async execute(): Promise<ListeningTestGroupDto[]> {
    const sources = await this.deps.repository.listActiveSources();
    return groupListeningSourcesIntoTests(sources);
  }
}
