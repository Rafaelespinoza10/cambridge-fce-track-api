import type { ListeningAttempt } from '@models/ListeningAttempt';
import type { ListeningItem } from '@models/ListeningItem';
import { ListeningAttemptStatus } from '@models/enums';
import type {
  ListeningSourceSafeDto,
  ListeningItemSafeDto,
} from '@repositories/mocks/listening-sources.repository';
import { toListeningAttemptSafeDto } from '@lib/listening/listening-attempt-dto';
import { buildListeningAttemptResultDto } from '@lib/listening/listening-attempt-grading';
import type { ListeningAttemptViewDto } from '../../interfaces/listening/listening-attempt.interface';

export enum GetListeningAttemptErrorCode {
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
}

export class GetListeningAttemptError extends Error {
  constructor(
    message: string,
    readonly code: GetListeningAttemptErrorCode,
  ) {
    super(message);
    this.name = 'GetListeningAttemptError';
  }
}

export interface ListeningAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<ListeningAttempt | null>;
}

export interface ListeningSourcesRepositoryPort {
  findActiveByIdSafe(sourceId: string): Promise<ListeningSourceSafeDto | null>;
  findByIdWithItems(
    sourceId: string,
  ): Promise<{ source: ListeningSourceSafeDto; items: ListeningItemSafeDto[] } | null>;
  findItemsWithAnswerKeysBySourceId(sourceId: string): Promise<ListeningItem[]>;
}

export interface GetListeningAttemptServiceDeps {
  attempts: ListeningAttemptsRepositoryPort;
  sources: ListeningSourcesRepositoryPort;
}

/**
 * `in_progress` -> safe items (never an answerKey), result: null.
 * `completed` -> the full, answer-revealing result (the student already submitted).
 * Reads the source unfiltered by status (findByIdWithItems, not the
 * active-only lookup) — an attempt made while a source was active must
 * still be viewable after an admin later deactivates that source.
 */
export class GetListeningAttemptService {
  constructor(private readonly deps: GetListeningAttemptServiceDeps) {}

  async execute(userId: string, attemptId: string): Promise<ListeningAttemptViewDto> {
    const attempt = await this.deps.attempts.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new GetListeningAttemptError(
        'Listening attempt not found',
        GetListeningAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }

    const withItems = await this.deps.sources.findByIdWithItems(attempt.source_id);
    if (withItems === null) {
      throw new Error('Failed to re-read the source for a listening attempt that references it');
    }

    if (attempt.status !== ListeningAttemptStatus.COMPLETED) {
      return {
        attempt: toListeningAttemptSafeDto(attempt),
        source: withItems.source,
        items: withItems.items,
        result: null,
      };
    }

    if (attempt.answers === null) {
      throw new Error('Completed listening attempt is missing its persisted answers');
    }
    const itemsWithKeys = await this.deps.sources.findItemsWithAnswerKeysBySourceId(
      attempt.source_id,
    );

    return {
      attempt: toListeningAttemptSafeDto(attempt),
      source: withItems.source,
      items: null,
      result: buildListeningAttemptResultDto(attempt, itemsWithKeys, attempt.answers),
    };
  }
}
