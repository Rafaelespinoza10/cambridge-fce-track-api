// Shape of the JSONB columns on the Daily Session entities. Kept here (not
// under interfaces/) because DailySession/DailySessionItem/DailySessionSubmission
// import these directly for column typing, and entities never depend on the
// interfaces/ layer. Structurally mirrors practice-json-types.ts /
// writing-json-types.ts on purpose but is NOT imported from either — this
// codebase never cross-imports domain JSON types, so a later Practice-only
// or Writing-only schema change can't silently affect Daily Session.

/** One target word/phrase the sentence-writing task asks the student to use. */
export interface DailySessionSentenceTarget {
  id: string;
  targetText: string;
  hint: string;
}

/**
 * Traceability-only metadata about how a session was generated. Never store
 * API keys, full prompts, or provider request/response bodies here — this is
 * persisted and readable, not a secrets store. knowledgeSourceNames records
 * which Cambridge Knowledge Base sources grounded the prompt (name + page
 * only) — never the chunk content itself.
 */
export interface DailySessionGenerationMetadata {
  provider?: string;
  topic?: string;
  knowledgeSourceNames?: string[];
  /** Cambridge part this session was aimed at, when one was weak enough to target. */
  focusSectionSlug?: string;
  focusSectionName?: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  schemaVersion?: string;
}

export interface DailySessionItemOption {
  id: string;
  label: string;
}

export type DailySessionItemAnswerKey =
  | {
      kind: 'single_choice';
      acceptedOptionIds: string[];
    }
  | {
      kind: 'text';
      acceptedAnswers: string[];
      caseSensitive: boolean;
    };

export type DailySessionAnswerPayload =
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

/** One graded comprehension answer, persisted in comprehension_answers. */
export interface DailySessionComprehensionAnswerRecord {
  itemId: string;
  answerPayload: DailySessionAnswerPayload;
  normalizedAnswer: string | null;
  isCorrect: boolean;
}

/** One submitted sentence for a sentence-task target, before grading. */
export interface DailySessionSentenceSubmission {
  targetId: string;
  submittedSentence: string;
}

/**
 * One target's LLM-graded result. evidenceQuote is only ever set once
 * verified as a real (case/whitespace-insensitive) substring of that
 * target's own submittedSentence — see SubmitDailySessionSubmissionService.
 */
export interface DailySessionSentenceFeedbackItem {
  targetId: string;
  usesTargetCorrectly: boolean;
  feedback: string;
  correctedSentence: string | null;
  evidenceQuote: string | null;
}

/**
 * Versioned so a future prompt/schema change doesn't break reading old rows
 * — same convention as WritingFeedback. correctCount is always computed in
 * code from `items`, never trusted from the model's own count.
 */
export interface DailySessionSentenceFeedback {
  version: 'daily-session-sentence-feedback-v1';
  items: DailySessionSentenceFeedbackItem[];
  correctCount: number;
  totalCount: number;
}
