import type { DailySessionSubmissionStatus, EnglishLevel } from '../../models/enums';

/**
 * One past Daily Session, flattened with a summary of its most recent
 * submission. Deliberately omits reading_passage and the sentence targets —
 * a history list renders titles and scores, and the full passage would
 * multiply the payload for no benefit. Tapping through fetches the session
 * (GET /daily-session/{sessionId}) or the graded result
 * (GET /daily-session/submissions/{submissionId}) as needed.
 *
 * Every submission field is null for a session that was generated but never
 * started, which is a normal state, not an error: a session row is created
 * the first time the user opens the day, whether or not they answer anything.
 */
export interface DailySessionHistoryItemDto {
  sessionId: string;
  /** Calendar day the session is FOR, 'YYYY-MM-DD' (not when it was generated). */
  sessionDate: string;
  topic: string;
  readingTitle: string;
  targetLevel: EnglishLevel | null;
  itemCount: number;
  createdAt: Date;

  /** Most recent submission for this session, or null if never started. */
  submissionId: string | null;
  submissionStatus: DailySessionSubmissionStatus | null;
  startedAt: Date | null;
  submittedAt: Date | null;
  durationSeconds: number | null;
  comprehensionCorrectCount: number | null;
  comprehensionTotalCount: number | null;
  comprehensionPercentage: number | null;
  sentenceCorrectCount: number | null;
  sentenceTotalCount: number | null;
}

export interface DailySessionHistoryPaginationDto {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface DailySessionHistoryResponseDto {
  items: DailySessionHistoryItemDto[];
  pagination: DailySessionHistoryPaginationDto;
}
