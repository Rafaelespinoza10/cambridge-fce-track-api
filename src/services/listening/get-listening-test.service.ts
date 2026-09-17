import type { ListeningTestGroupDto } from '@lib/listening/listening-test-grouping';
import { groupListeningSourcesIntoTests } from '@lib/listening/listening-test-grouping';
import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

export enum GetListeningTestErrorCode {
  TEST_NOT_FOUND = 'TEST_NOT_FOUND',
}

export class GetListeningTestError extends Error {
  constructor(
    message: string,
    readonly code: GetListeningTestErrorCode,
  ) {
    super(message);
    this.name = 'GetListeningTestError';
  }
}

export interface GetListeningTestRepositoryPort {
  listActiveSources(): Promise<ListeningSourceSafeDto[]>;
}

export interface GetListeningTestServiceDeps {
  repository: GetListeningTestRepositoryPort;
}

/** Detail for one curated Listening test (all active parts that share the video id). */
export class GetListeningTestService {
  constructor(private readonly deps: GetListeningTestServiceDeps) {}

  async execute(videoExternalId: string): Promise<ListeningTestGroupDto> {
    const trimmed = videoExternalId.trim();
    if (!trimmed) {
      throw new GetListeningTestError(
        'Listening test not found',
        GetListeningTestErrorCode.TEST_NOT_FOUND,
      );
    }

    const sources = await this.deps.repository.listActiveSources();
    const match = groupListeningSourcesIntoTests(sources).find(
      (test) => test.videoExternalId === trimmed,
    );
    if (!match) {
      throw new GetListeningTestError(
        'Listening test not found',
        GetListeningTestErrorCode.TEST_NOT_FOUND,
      );
    }
    return match;
  }
}
