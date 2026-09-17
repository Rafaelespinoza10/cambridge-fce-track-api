import type { ListeningAttemptStatus } from '../../models/enums';
import type {
  PracticeAnswerPayload,
  PracticeItemOption,
} from '../../models/practice-json-types';
import type { ListeningAttemptFeedbackSummary } from '../../models/listening-json-types';
import type { ListeningSourceSafeDto, ListeningItemSafeDto } from '../../repositories/mocks/listening-sources.repository';

export interface SubmitListeningAttemptAnswerInput {
  itemId: string;
  answer: PracticeAnswerPayload;
  responseTimeMs?: number | null;
}

export interface SubmitListeningAttemptRequest {
  answers: SubmitListeningAttemptAnswerInput[];
}

/** Never carries userId or soft-delete fields. */
export interface ListeningAttemptSafeDto {
  id: string;
  sourceId: string;
  status: ListeningAttemptStatus;
  startedAt: Date;
  totalCount: number;
}

/**
 * Only ever built for a `completed` attempt — the one place in the
 * Listening domain allowed to reveal a correct answer, since the student
 * has already submitted and been graded.
 */
export interface ListeningAttemptItemResultDto {
  itemId: string;
  position: number;
  prompt: string;
  options: PracticeItemOption[] | null;
  userAnswer: PracticeAnswerPayload;
  normalizedAnswer: string | null;
  isCorrect: boolean;
  /** Correct option labels (single_choice) or the literal accepted strings (text). */
  acceptedAnswers: string[];
  explanation: string | null;
  skillTags: string[];
  responseTimeMs: number | null;
}

export interface ListeningAttemptResultDto {
  attemptId: string;
  sourceId: string;
  submittedAt: Date;
  durationSeconds: number;
  correctCount: number;
  totalCount: number;
  percentage: number;
  feedbackSummary: ListeningAttemptFeedbackSummary;
  items: ListeningAttemptItemResultDto[];
}

/**
 * `items` is populated for `in_progress` (never carries an answerKey — the
 * same safe projection the public GET/start endpoints already return).
 * `result` is populated only for `completed`. Exactly one of the two is
 * non-null.
 */
export interface ListeningAttemptViewDto {
  attempt: ListeningAttemptSafeDto;
  source: ListeningSourceSafeDto;
  items: ListeningItemSafeDto[] | null;
  result: ListeningAttemptResultDto | null;
}

export interface ListeningAttemptStartResultDto {
  view: ListeningAttemptViewDto;
}

export interface ListeningAttemptSubmitResultDto {
  result: ListeningAttemptResultDto;
  idempotentReplay: boolean;
}
