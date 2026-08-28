/** Body of `POST /practice/mistakes/remix`. All weakness selection happens server-side from the JWT user — the client only picks a size. */
export interface GenerateMistakeRemixRequest {
  questionCount?: number;
  idempotencyKey: string;
}

/** Quick (default) and Challenge — see docs/mistake-bank.md §10. */
export const MISTAKE_REMIX_QUESTION_COUNTS = [8, 15] as const;
export type MistakeRemixQuestionCount = (typeof MISTAKE_REMIX_QUESTION_COUNTS)[number];
export const DEFAULT_MISTAKE_REMIX_QUESTION_COUNT: MistakeRemixQuestionCount = 8;
