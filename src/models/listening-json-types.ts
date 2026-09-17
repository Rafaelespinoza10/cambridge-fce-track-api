// Shape of the JSONB columns on ListeningAttempt. Kept here (not under
// interfaces/) for the same reason as practice-json-types.ts — the entity
// imports these directly for column typing, and entities never depend on
// the interfaces/ layer.
import type { PracticeAnswerPayload } from './practice-json-types';

/**
 * One graded answer to one ListeningItem, persisted inline on the attempt
 * row's `answers` JSONB array rather than a separate child table — see
 * ListeningAttempt's own doc comment for why. Field names mirror
 * PracticeAnswer's columns one-for-one so
 * lib/listening/listening-attempt-grading.ts can build the same kind of
 * result DTO practice-attempt-grading.ts builds for Practice.
 */
export interface ListeningAttemptAnswerEntry {
  itemId: string;
  answerPayload: PracticeAnswerPayload;
  normalizedAnswer: string | null;
  isCorrect: boolean;
  responseTimeMs: number | null;
}

/** Per-skill-tag correctness breakdown for one completed attempt — same shape as PracticeAttemptSkillBreakdownEntry. */
export interface ListeningAttemptSkillBreakdownEntry {
  skillTag: string;
  correctCount: number;
  totalCount: number;
  percentage: number;
}

export interface ListeningAttemptFeedbackSummary {
  version: 'listening-attempt-feedback-v1';
  unansweredCount: number;
  skillBreakdown: ListeningAttemptSkillBreakdownEntry[];
}
