import type { PracticeAttempt } from '@models/PracticeAttempt';
import type { PracticeAttemptSafeDto } from '../../interfaces/practice/practice-attempt.interface';

/** Never carries userId or soft-delete fields. Shared by every attempt service. */
export function toPracticeAttemptSafeDto(attempt: PracticeAttempt): PracticeAttemptSafeDto {
  return {
    id: attempt.id,
    exerciseId: attempt.exercise_id,
    status: attempt.status,
    startedAt: attempt.started_at,
    totalCount: attempt.total_count,
  };
}
