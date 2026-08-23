import type {
  PracticeItemAnswerKey,
  PracticeItemOption,
  PracticeAnswerPayload,
  PracticeAttemptFeedbackSummary,
  PracticeAttemptSkillBreakdownEntry,
} from '@models/practice-json-types';
import type { PracticeAttempt } from '@models/PracticeAttempt';
import type { PracticeItem } from '@models/PracticeItem';
import type { PracticeAnswer } from '@models/PracticeAnswer';
import type {
  PracticeAttemptResultDto,
  PracticeAttemptItemResultDto,
} from '../../interfaces/practice/practice-attempt.interface';

/**
 * Deterministic answer normalization/grading — no AI, no spell-correction,
 * no fuzzy/semantic matching. This is the only place PracticeItem answer
 * keys are compared against a submitted PracticeAnswerPayload.
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
  answerKey: PracticeItemAnswerKey,
  payload: PracticeAnswerPayload,
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

export interface FeedbackInputItem {
  skillTags: string[];
  isCorrect: boolean;
  isUnanswered: boolean;
}

/**
 * Aggregates per-skill correctness across every item in a completed attempt.
 * Purely computed from already-graded items — no AI, no recommendations, no
 * estimated level.
 */
export function computeFeedbackSummary(items: FeedbackInputItem[]): PracticeAttemptFeedbackSummary {
  const unansweredCount = items.filter((item) => item.isUnanswered).length;

  const bySkill = new Map<string, { correctCount: number; totalCount: number }>();
  for (const item of items) {
    for (const tag of item.skillTags) {
      const entry = bySkill.get(tag) ?? { correctCount: 0, totalCount: 0 };
      entry.totalCount += 1;
      if (item.isCorrect) entry.correctCount += 1;
      bySkill.set(tag, entry);
    }
  }

  const skillBreakdown: PracticeAttemptSkillBreakdownEntry[] = Array.from(bySkill.entries()).map(
    ([skillTag, { correctCount, totalCount }]) => ({
      skillTag,
      correctCount,
      totalCount,
      percentage: roundToTwoDecimals((correctCount / totalCount) * 100),
    }),
  );

  return {
    version: 'practice-attempt-feedback-v1',
    unansweredCount,
    skillBreakdown,
  };
}

/**
 * Structural, not `PracticeItem`-specific — `ListeningItem` mirrors these
 * same two columns (see its own doc comment on why) and satisfies this
 * shape without a cast, so mock-attempt review/flashcard-draft code can
 * reuse this and formatUserAnswer for a Listening item exactly like a
 * Practice one.
 */
export interface GradableItemLike {
  answer_key: PracticeItemAnswerKey;
  options: PracticeItemOption[] | null;
}

export function formatAcceptedAnswers(item: GradableItemLike): string[] {
  const key = item.answer_key;
  if (key.kind === 'single_choice') {
    const optionsById = new Map((item.options ?? []).map((option) => [option.id, option.label]));
    return key.acceptedOptionIds.map((id) => optionsById.get(id) ?? id);
  }
  return key.acceptedAnswers;
}

/**
 * Renders what the student actually answered as a single human-readable
 * string — a single_choice optionId resolves to its option label (falling
 * back to the raw id if the option was somehow removed), a text answer is
 * used as-is, and `unanswered` renders as an explicit placeholder rather
 * than an empty string.
 */
export function formatUserAnswer(item: GradableItemLike, payload: PracticeAnswerPayload): string {
  if (payload.kind === 'unanswered') return '(no answer given)';
  if (payload.kind === 'single_choice') {
    const optionsById = new Map((item.options ?? []).map((option) => [option.id, option.label]));
    return optionsById.get(payload.optionId) ?? payload.optionId;
  }
  return payload.value;
}

/**
 * Builds the full, answer-revealing result DTO for a `completed` attempt —
 * used by both SubmitPracticeAttemptService (fresh submit + replay) and
 * GetPracticeAttemptService, so the two can never drift. `itemsWithKeys` must
 * come from PracticeExercisesRepository.findExerciseWithAnswerKeysForEvaluation
 * (the only place answer_key/explanation are ever selected).
 */
export function buildPracticeAttemptResultDto(
  attempt: PracticeAttempt,
  itemsWithKeys: PracticeItem[],
  answers: PracticeAnswer[],
): PracticeAttemptResultDto {
  if (attempt.submitted_at === null || attempt.duration_seconds === null) {
    throw new Error('buildPracticeAttemptResultDto requires a completed attempt');
  }
  if (attempt.correct_count === null || attempt.percentage === null) {
    throw new Error('buildPracticeAttemptResultDto requires a completed attempt');
  }

  const answersByItemId = new Map(answers.map((answer) => [answer.item_id, answer]));
  const sortedItems = [...itemsWithKeys].sort((a, b) => a.position - b.position);

  const items: PracticeAttemptItemResultDto[] = sortedItems.map((item) => {
    const answer = answersByItemId.get(item.id);
    if (answer === undefined) {
      throw new Error(`missing persisted answer for item ${item.id} on a completed attempt`);
    }
    return {
      itemId: item.id,
      position: item.position,
      prompt: item.prompt,
      options: item.options,
      userAnswer: answer.answer_payload,
      normalizedAnswer: answer.normalized_answer,
      isCorrect: answer.is_correct,
      acceptedAnswers: formatAcceptedAnswers(item),
      explanation: item.explanation,
      skillTags: item.skill_tags,
      responseTimeMs: answer.response_time_ms,
    };
  });

  return {
    attemptId: attempt.id,
    exerciseId: attempt.exercise_id,
    submittedAt: attempt.submitted_at,
    durationSeconds: attempt.duration_seconds,
    correctCount: attempt.correct_count,
    totalCount: attempt.total_count,
    percentage: Number(attempt.percentage),
    feedbackSummary: attempt.feedback_summary ?? computeFeedbackSummary([]),
    items,
  };
}
