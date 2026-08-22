// Shape of the JSONB columns on the mock-attempt entities. Kept here (not
// under interfaces/) for the same reason as practice-json-types.ts: entities
// import these directly for column typing and never depend on interfaces/.

import type { PracticeAnswerPayload } from './practice-json-types';
import type { WritingFeedback } from './writing-json-types';
import type { PracticeAttemptFeedbackSummary } from './practice-json-types';

/** One answer to an objective (practice_exercise/listening) section item. */
export interface MockAttemptObjectiveAnswer {
  itemId: string;
  answer: PracticeAnswerPayload;
  responseTimeMs?: number | null;
}

/**
 * `mock_attempt_sections.answers` — shape depends on the section's
 * content_type. 'objective' covers both practice_exercise (Use of
 * English/Reading) and listening sections, since both grade with the same
 * pure gradeItem()/computeFeedbackSummary() functions
 * (lib/practice/practice-attempt-grading.ts). 'writing' holds the student's
 * draft text for the one writing_task section being answered.
 */
export type MockAttemptSectionAnswers =
  | { kind: 'objective'; answers: MockAttemptObjectiveAnswer[] }
  | { kind: 'writing'; content: string };

/**
 * `mock_attempt_sections.grading_feedback` — computed once at section-submit
 * time, never AI-generated for objective sections (reuses
 * PracticeAttemptFeedbackSummary verbatim) and LLM-graded (with the same
 * rubric/schema submit-writing-submission.service.ts already uses) for
 * writing sections.
 */
export type MockAttemptSectionGradingFeedback =
  | ({ kind: 'objective' } & PracticeAttemptFeedbackSummary)
  | ({ kind: 'writing' } & WritingFeedback);
