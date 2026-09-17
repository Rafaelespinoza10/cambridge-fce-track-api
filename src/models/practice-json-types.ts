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
  generationSource?: 'mistake_practice' | 'mistake_remix' | 'spaced_retest';
  /** Every MistakeConcept.id this session actually targeted (see MistakeSlotPlan.usedConceptIds). */
  mistakeConceptIds?: string[];
  targetErrorTypes?: string[];
  targetErrorSubtypes?: string[];
  /** Mistake Remix only — the weighted, capped pattern allocation this session actually used. */
  remixTargetPatterns?: {
    errorType: string;
    errorSubtype: string | null;
    questionCount: number;
  }[];
  /** Mistake Remix only — how many of the session's items were neutral control questions. */
  remixNeutralCount?: number;
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
  /**
   * `mistake_practice` — the student chose to work on a known weakness.
   * `spaced_retest` — days have passed and the app is checking whether the
   * pattern stuck. Both are remediation evidence for mastery (the query
   * accepts either), but they are never conflated: only a retest can close a
   * scheduled review or move the interval ladder.
   */
  generationSource: 'mistake_practice' | 'spaced_retest';
  practiceMode: 'concept_specific' | 'pattern_transfer';
  targetConceptId: string;
  targetErrorType: string;
  targetErrorSubtype: string | null;
  /**
   * The lexical family THIS generated item is about, extracted
   * deterministically from its own prompt (see extractBaseWord). Null when
   * the task type carries no root word or the prompt was ambiguous.
   *
   * It is what makes "transfer" measurable: a pattern-transfer item targets
   * a past concept but deliberately uses a NEW word, so the targeted
   * concept's own base word says nothing about which families the student
   * has actually proved. Items generated before this field existed count as
   * attempts, and the mastery query falls back to the answer the student
   * produced for their family attribution.
   */
  itemBaseWord: string | null;
  /**
   * The WeaknessReview this item was generated for. Set only when
   * `generationSource === 'spaced_retest'`; it is what lets the submit flow
   * close the right review without trusting anything the client sent.
   */
  scheduledReviewId?: string;
}

/**
 * The shape GenerateMistakeRemixExerciseService writes into every item it
 * generates. Deliberately reuses `targetErrorType`/`targetErrorSubtype`/
 * `itemBaseWord` field names verbatim from MistakePracticeItemMetadata so the
 * mastery aggregation (mistake-mastery.repository.ts) needs only a widened
 * `generationSource IN (...)`, never a second query shape. `questionRole`
 * distinguishes a targeted item (feeds mastery for its pattern) from a
 * neutral control item (`targetErrorType`/`targetErrorSubtype` both null,
 * which already excludes it from remediation aggregation with no extra
 * filtering — see docs/mistake-bank.md §10).
 */
export interface MistakeRemixItemMetadata extends Record<string, unknown> {
  generationSource: 'mistake_remix';
  questionRole: 'targeted' | 'neutral';
  targetErrorType: string | null;
  targetErrorSubtype: string | null;
  itemBaseWord: string | null;
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
