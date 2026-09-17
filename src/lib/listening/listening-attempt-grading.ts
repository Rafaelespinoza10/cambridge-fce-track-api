import type { ListeningItemSafeDto } from '@repositories/mocks/listening-sources.repository';
import type { ListeningItem } from '@models/ListeningItem';
import type { ListeningAttempt } from '@models/ListeningAttempt';
import type { ListeningAttemptAnswerEntry } from '@models/listening-json-types';
import {
  gradeItem,
  roundToTwoDecimals,
  computeFeedbackSummary,
  formatAcceptedAnswers,
} from '@lib/practice/practice-attempt-grading';
import type {
  ListeningAttemptItemResultDto,
  ListeningAttemptResultDto,
} from '../../interfaces/listening/listening-attempt.interface';

// Re-exported so callers only ever import grading primitives from one
// place — ListeningItem mirrors PracticeItem's answer_key/options columns
// exactly (see that model's own doc comment), so these pure functions work
// unchanged against it.
export { gradeItem, roundToTwoDecimals, computeFeedbackSummary };

/**
 * Builds the full, answer-revealing result DTO for a `completed` attempt —
 * used by both SubmitListeningAttemptService (fresh submit + replay) and
 * GetListeningAttemptService, so the two can never drift. `itemsWithKeys`
 * must come from ListeningSourcesRepository.findItemsWithAnswerKeysBySourceId
 * (the only place answer_key/explanation are ever selected).
 */
export function buildListeningAttemptResultDto(
  attempt: ListeningAttempt,
  itemsWithKeys: ListeningItem[],
  answers: ListeningAttemptAnswerEntry[],
): ListeningAttemptResultDto {
  if (attempt.submitted_at === null || attempt.duration_seconds === null) {
    throw new Error('buildListeningAttemptResultDto requires a completed attempt');
  }
  if (attempt.correct_count === null || attempt.percentage === null) {
    throw new Error('buildListeningAttemptResultDto requires a completed attempt');
  }

  const answersByItemId = new Map(answers.map((answer) => [answer.itemId, answer]));
  const sortedItems = [...itemsWithKeys].sort((a, b) => a.position - b.position);

  const items: ListeningAttemptItemResultDto[] = sortedItems.map((item) => {
    const answer = answersByItemId.get(item.id);
    if (answer === undefined) {
      throw new Error(`missing persisted answer for item ${item.id} on a completed attempt`);
    }
    return {
      itemId: item.id,
      position: item.position,
      prompt: item.prompt,
      options: item.options,
      userAnswer: answer.answerPayload,
      normalizedAnswer: answer.normalizedAnswer,
      isCorrect: answer.isCorrect,
      acceptedAnswers: formatAcceptedAnswers(item),
      explanation: item.explanation,
      skillTags: item.skill_tags,
      responseTimeMs: answer.responseTimeMs,
    };
  });

  return {
    attemptId: attempt.id,
    sourceId: attempt.source_id,
    submittedAt: attempt.submitted_at,
    durationSeconds: attempt.duration_seconds,
    correctCount: attempt.correct_count,
    totalCount: attempt.total_count,
    percentage: Number(attempt.percentage),
    feedbackSummary: attempt.feedback_summary ?? {
      version: 'listening-attempt-feedback-v1',
      unansweredCount: 0,
      skillBreakdown: [],
    },
    items,
  };
}

export function toListeningItemSafeDto(item: ListeningItem): ListeningItemSafeDto {
  return {
    id: item.id,
    position: item.position,
    prompt: item.prompt,
    options: item.options,
    skillTags: item.skill_tags,
  };
}
