import type { ListeningAttempt } from '@models/ListeningAttempt';
import type { ListeningAttemptSafeDto } from '../../interfaces/listening/listening-attempt.interface';

/** Never carries userId or soft-delete fields. Shared by every attempt service. */
export function toListeningAttemptSafeDto(attempt: ListeningAttempt): ListeningAttemptSafeDto {
  return {
    id: attempt.id,
    sourceId: attempt.source_id,
    status: attempt.status,
    startedAt: attempt.started_at,
    totalCount: attempt.total_count,
  };
}
