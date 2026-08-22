import type {
  DailySessionItemAnswerKey,
  DailySessionAnswerPayload,
} from '@models/daily-session-json-types';

/**
 * Deterministic answer normalization/grading for the comprehension part of a
 * Daily Session — no AI, no spell-correction, no fuzzy/semantic matching.
 * Mirrors src/lib/practice/practice-attempt-grading.ts (deliberately not
 * imported from it — see the domain-isolation note on
 * daily-session-json-types.ts). This is the only place DailySessionItem
 * answer keys are compared against a submitted DailySessionAnswerPayload.
 * The sentence-writing task is graded separately, by the LLM, in
 * SubmitDailySessionSubmissionService — never here.
 */

// Apostrophe-like characters a client might send for a contraction
// (curly/straight quotes, acute accent used as a typographic substitute,
// backtick) all collapse to a single canonical apostrophe before compare.
const APOSTROPHE_VARIANTS = /[‘’ʼ´`]/g;

export function normalizeTextAnswer(value: string, caseSensitive: boolean): string {
  // Apostrophe substitution runs BEFORE NFKC: U+00B4 (standalone acute
  // accent) NFKC-decomposes into U+0020 U+0301 (space + combining acute), so
  // substituting it after NFKC would silently fail to match.
  let normalized = value
    .replace(APOSTROPHE_VARIANTS, "'")
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
  if (!caseSensitive) normalized = normalized.toLowerCase();
  return normalized;
}

export interface GradedAnswer {
  isCorrect: boolean;
  normalizedAnswer: string | null;
}

/**
 * Grades a single submitted payload against the item's real answer key.
 * `unanswered` is always incorrect. Never trusts anything client-supplied
 * beyond the payload's own value/optionId — no external score/isCorrect input.
 */
export function gradeItem(
  answerKey: DailySessionItemAnswerKey,
  payload: DailySessionAnswerPayload,
): GradedAnswer {
  if (payload.kind === 'unanswered') {
    return { isCorrect: false, normalizedAnswer: null };
  }

  if (answerKey.kind === 'single_choice') {
    if (payload.kind !== 'single_choice') {
      return { isCorrect: false, normalizedAnswer: null };
    }
    return {
      isCorrect: answerKey.acceptedOptionIds.includes(payload.optionId),
      normalizedAnswer: payload.optionId,
    };
  }

  // answerKey.kind === 'text'
  if (payload.kind !== 'text') {
    return { isCorrect: false, normalizedAnswer: null };
  }
  const normalized = normalizeTextAnswer(payload.value, answerKey.caseSensitive);
  const acceptedNormalized = answerKey.acceptedAnswers.map((answer) =>
    normalizeTextAnswer(answer, answerKey.caseSensitive),
  );
  return {
    isCorrect: acceptedNormalized.includes(normalized),
    normalizedAnswer: normalized,
  };
}

export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
