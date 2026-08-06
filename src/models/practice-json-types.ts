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

// Open-ended placeholders — no consumer defines their shape yet. Kept as
// plain JSON bags on purpose; a later PR (grading/feedback) will narrow them.
export type PracticeItemMetadata = Record<string, unknown>;
export type PracticeAttemptFeedbackSummary = Record<string, unknown>;
export type PracticeAnswerFeedback = Record<string, unknown>;
