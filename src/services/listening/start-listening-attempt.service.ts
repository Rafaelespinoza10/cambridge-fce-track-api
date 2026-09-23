import type { ListeningAttempt } from '@models/ListeningAttempt';
import type { ListeningSourceSafeWithItems } from '@repositories/mocks/listening-sources.repository';
import type { CreateListeningAttemptData } from '@repositories/listening/listening-attempts.repository';
import { toListeningAttemptSafeDto } from '@lib/listening/listening-attempt-dto';
import type { ListeningAttemptStartResultDto } from '../../interfaces/listening/listening-attempt.interface';

export enum StartListeningAttemptErrorCode {
  INVALID_INPUT = 'invalid_input',
  SOURCE_NOT_FOUND = 'source_not_found',
}

export class StartListeningAttemptError extends Error {
  constructor(
    message: string,
    readonly code: StartListeningAttemptErrorCode,
  ) {
    super(message);
    this.name = 'StartListeningAttemptError';
  }
}

export interface ListeningSourcesRepositoryPort {
  findActiveByIdWithItems(sourceId: string): Promise<ListeningSourceSafeWithItems | null>;
}

export interface ListeningAttemptsRepositoryPort {
  createAttempt(data: CreateListeningAttemptData): Promise<ListeningAttempt>;
}

export interface StartListeningAttemptServiceDeps {
  sources: ListeningSourcesRepositoryPort;
  attempts: ListeningAttemptsRepositoryPort;
}

function invalidInput(message: string): never {
  throw new StartListeningAttemptError(message, StartListeningAttemptErrorCode.INVALID_INPUT);
}

/**
 * Always creates a fresh attempt — unlike Practice, ListeningSource content
 * is static and free to replay, so there is no "one active attempt per
 * user" constraint and no resume branch (see ListeningAttempt's own doc
 * comment).
 */
export class StartListeningAttemptService {
  constructor(private readonly deps: StartListeningAttemptServiceDeps) {}

  async execute(
    userId: string,
    sourceId: string,
    startedAt: Date,
  ): Promise<ListeningAttemptStartResultDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (typeof sourceId !== 'string' || sourceId.trim() === '') {
      invalidInput('sourceId is required');
    }
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
      invalidInput('startedAt must be a valid Date');
    }

    const withItems = await this.deps.sources.findActiveByIdWithItems(sourceId);
    if (withItems === null) {
      throw new StartListeningAttemptError(
        'Listening source not found',
        StartListeningAttemptErrorCode.SOURCE_NOT_FOUND,
      );
    }
    if (withItems.items.length === 0) {
      throw new StartListeningAttemptError(
        'This listening source has no items yet',
        StartListeningAttemptErrorCode.SOURCE_NOT_FOUND,
      );
    }

    const attempt = await this.deps.attempts.createAttempt({
      userId,
      sourceId: withItems.source.id,
      startedAt,
      totalCount: withItems.items.length,
    });

    return {
      view: {
        attempt: toListeningAttemptSafeDto(attempt),
        source: withItems.source,
        items: withItems.items,
        result: null,
      },
    };
  }
}
