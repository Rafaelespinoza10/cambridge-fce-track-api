import type { CambridgeSourceDto } from '../../repositories/cambridge-sources.repository';

export interface CambridgeSourcesRepositoryPort {
  listSources(): Promise<CambridgeSourceDto[]>;
}

export interface ListCambridgeSourcesServiceDeps {
  repository: CambridgeSourcesRepositoryPort;
}

/** Thin read wrapper: mirrors WritingTasksService. */
export class ListCambridgeSourcesService {
  constructor(private readonly deps: ListCambridgeSourcesServiceDeps) {}

  async execute(): Promise<CambridgeSourceDto[]> {
    return this.deps.repository.listSources();
  }
}
