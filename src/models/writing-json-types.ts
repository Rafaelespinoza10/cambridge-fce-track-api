// Shape of the JSONB columns on the Writing entities. Kept here (not under
// interfaces/) for the same reason as practice-json-types.ts: entities
// import these directly for column typing and never depend on interfaces/.

/**
 * Traceability-only metadata about how an AI-sourced writing task was
 * generated. Never store API keys, full prompts, or provider
 * request/response headers here — this is persisted and readable, not a
 * secrets store. Mirrors PracticeExerciseGenerationMetadata exactly.
 */
export interface WritingTaskGenerationMetadata {
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  schemaVersion?: string;
}

export type WritingCorrectionCategory =
  | 'grammar'
  | 'vocabulary'
  | 'spelling'
  | 'punctuation'
  | 'register'
  | 'other';

/** One of the 4 official FCE Writing criteria — reuses ScoreCriterion, never a separate enum. */
export interface WritingCriterionFeedback {
  criterion: 'content' | 'communicative_achievement' | 'organization' | 'language';
  /** 0-5, Cambridge Writing band per criterion. */
  band: number;
  justification: string;
  /** 1-3 short verbatim quotes from the submitted text, each verified as a real substring before persisting. */
  evidenceQuotes: string[];
}

/**
 * `id` is the correction's position within `corrections` (as a string, e.g.
 * "0", "1") — stable for the lifetime of a graded submission (the array is
 * never reordered/mutated after grading), used as the
 * `:correctionId` route param for the flashcard-draft endpoint. Not a UUID —
 * corrections are never their own DB rows.
 */
export interface WritingCorrection {
  id: string;
  originalExcerpt: string;
  correctedExcerpt: string;
  explanation: string;
  category: WritingCorrectionCategory;
}

/**
 * Computed once, at submit/grade time, by submit-writing-submission.service.ts.
 * `overallBand` is always the sum of the 4 criteria bands (out of 20,
 * matching real FCE Writing marking) computed in code — never trusted
 * directly from the model's own arithmetic.
 */
export interface WritingFeedback {
  version: 'writing-feedback-v1';
  criteria: WritingCriterionFeedback[];
  overallBand: number;
  maxBand: 20;
  corrections: WritingCorrection[];
  rewrittenText: string;
  summary: string;
}
