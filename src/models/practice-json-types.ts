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
  /**
   * Absent for a normal AI-generated exercise. Set only by
   * GenerateMistakePracticeExerciseService, so a later report can tell "this
   * exercise was built from the Mistake Bank" apart from a plain generation
   * — without a new PracticeExerciseSource enum value (and its migration).
   */
  generationSource?: 'mistake_practice';
  /** Every MistakeConcept.id this session actually targeted (see MistakeSlotPlan.usedConceptIds). */
  mistakeConceptIds?: string[];
  targetErrorTypes?: string[];
  targetErrorSubtypes?: string[];
}

// Open-ended placeholder — no consumer defines its shape yet, EXCEPT
// GenerateMistakePracticeExerciseService, which writes
// MistakePracticeItemMetadata below. Kept as a plain JSON bag on purpose so
// nothing here ever needs a migration.
export type PracticeItemMetadata = Record<string, unknown>;

/**
 * The shape GenerateMistakePracticeExerciseService writes into every item it
 * generates — lets a future mastery/rollup PR compute "times practiced /
 * correct during remediation / incorrect during remediation" per
 * MistakeConcept by joining practice_answers -> practice_items on
 * `metadata->>'targetConceptId'`, with no new column or migration. See
 * docs/mistake-bank.md §6.
 */
export interface MistakePracticeItemMetadata extends Record<string, unknown> {
  generationSource: 'mistake_practice';
  practiceMode: 'concept_specific' | 'pattern_transfer';
  targetConceptId: string;
  targetErrorType: string;
  targetErrorSubtype: string | null;
}

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
