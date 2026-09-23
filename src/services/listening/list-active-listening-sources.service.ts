import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

export interface ListActiveListeningSourcesRepositoryPort {
  listActiveSources(): Promise<ListeningSourceSafeDto[]>;
}

export interface ListActiveListeningSourcesServiceDeps {
  repository: ListActiveListeningSourcesRepositoryPort;
}

/** The user-facing catalog (GET /listening/sources) — see ListeningSourcesRepository.listActiveSources for why this is pre-filtered to ACTIVE. */
export class ListActiveListeningSourcesService {
  constructor(private readonly deps: ListActiveListeningSourcesServiceDeps) {}

  async execute(): Promise<ListeningSourceSafeDto[]> {
    return this.deps.repository.listActiveSources();
  }
}
