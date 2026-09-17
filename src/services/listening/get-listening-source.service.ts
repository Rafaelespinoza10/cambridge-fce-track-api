import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

export enum GetListeningSourceErrorCode {
  SOURCE_NOT_FOUND = 'source_not_found',
}

export class GetListeningSourceError extends Error {
  constructor(
    message: string,
    readonly code: GetListeningSourceErrorCode,
  ) {
    super(message);
    this.name = 'GetListeningSourceError';
  }
}

export interface GetListeningSourceRepositoryPort {
  findActiveByIdSafe(sourceId: string): Promise<ListeningSourceSafeDto | null>;
}

export interface GetListeningSourceServiceDeps {
  repository: GetListeningSourceRepositoryPort;
}

/** The preview screen (GET /listening/sources/{sourceId}) — metadata only, never the items/answer keys. 404s for a missing OR inactive source alike (see repository doc comment). */
export class GetListeningSourceService {
  constructor(private readonly deps: GetListeningSourceServiceDeps) {}

  async execute(sourceId: string): Promise<ListeningSourceSafeDto> {
    const source = await this.deps.repository.findActiveByIdSafe(sourceId);
    if (source === null) {
      throw new GetListeningSourceError(
        'Listening source not found',
        GetListeningSourceErrorCode.SOURCE_NOT_FOUND,
      );
    }
    return source;
  }
}
