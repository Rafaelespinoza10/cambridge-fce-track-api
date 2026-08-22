import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

export interface ListeningSourcesRepositoryPort {
  listSources(): Promise<ListeningSourceSafeDto[]>;
}

export interface ListListeningSourcesServiceDeps {
  repository: ListeningSourcesRepositoryPort;
}

export class ListListeningSourcesService {
  constructor(private readonly deps: ListListeningSourcesServiceDeps) {}

  async execute(): Promise<ListeningSourceSafeDto[]> {
    return this.deps.repository.listSources();
  }
}
