/**
 * Body of `POST /practice/mistakes/generate`. Two modes, distinguished at
 * runtime (not via a TS discriminated union — this is unvalidated JSON off
 * the wire, same treatment SubmitPracticeAttemptService gives its input):
 *   - `mode: 'weaknesses'` — auto-selects from the user's own Mistake Bank.
 *   - `mode` omitted — `mistakeConceptIds` must be a non-empty array.
 */
export interface GenerateMistakePracticeRequest {
  mode?: 'weaknesses' | 'retest';
  mistakeConceptIds?: string[];
  /**
   * `mode: 'retest'` only. Which scheduled reviews to take now; omitted
   * means "everything that is due". Ownership is checked server-side, so an
   * id belonging to someone else is simply not found.
   */
  reviewIds?: string[];
  /** Ignored for `mode: 'retest'` — a review's size is decided by how many patterns it covers. */
  questionCount?: number;
  idempotencyKey: string;
}

/** The only session sizes this generator accepts — see docs/mistake-bank.md. */
export const MISTAKE_PRACTICE_QUESTION_COUNTS = [5, 8, 10, 15, 20] as const;
export type MistakePracticeQuestionCount = (typeof MISTAKE_PRACTICE_QUESTION_COUNTS)[number];
export const DEFAULT_MISTAKE_PRACTICE_QUESTION_COUNT: MistakePracticeQuestionCount = 8;
