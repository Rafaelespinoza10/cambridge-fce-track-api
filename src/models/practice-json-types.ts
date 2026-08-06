// Shape of the JSONB columns on the Practice entities. Kept here (not under
// interfaces/) because PracticeItem/PracticeExercise import these directly
// for column typing, and entities never depend on the interfaces/ layer.

export interface PracticeItemOption {
  id: string;
  label: string;
}

export type PracticeItemAnswerKey =
  | {
      kind: 'single_choice';
      acceptedOptionIds: string[];
    }
  | {
      kind: 'text';
      acceptedAnswers: string[];
      caseSensitive: boolean;
    };

export type PracticeAnswerPayload =
  | {
      kind: 'single_choice';
      optionId: string;
    }
  | {
      kind: 'text';
      value: string;
    }
  | {
      kind: 'unanswered';
    };

/**
 * Traceability-only metadata about how an AI-sourced exercise was generated.
 * Never store API keys, full prompts, or provider request/response headers
 * here — this is persisted and readable, not a secrets store.
 */
export interface PracticeExerciseGenerationMetadata {
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  schemaVersion?: string;
}

// Open-ended placeholder — no consumer defines its shape yet. Kept as a
// plain JSON bag on purpose.
export type PracticeItemMetadata = Record<string, unknown>;

// Still an open placeholder — no consumer defines a shape for a single
// answer's own feedback yet (everything PR 3 needs is reconstructable from
// PracticeAnswer's own columns joined with PracticeItem, so nothing is
// persisted here yet).
export type PracticeAnswerFeedback = Record<string, unknown>;

/** Per-skill correctness breakdown for one completed attempt. */
export interface PracticeAttemptSkillBreakdownEntry {
  skillTag: string;
  correctCount: number;
  totalCount: number;
  percentage: number;
}

/**
 * Narrows the PR 1 placeholder into a concrete shape: computed once, at
 * submit time, by src/lib/practice-attempt-grading.ts — never AI-generated,
 * no recommendations, no estimated level.
 */
export interface PracticeAttemptFeedbackSummary {
  version: 'practice-attempt-feedback-v1';
  unansweredCount: number;
  skillBreakdown: PracticeAttemptSkillBreakdownEntry[];
}
