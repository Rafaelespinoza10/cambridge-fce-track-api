import { DailySessionSubmissionStatus } from '../../models/enums';
import type {
  ListDailySessionHistoryResult,
  DailySessionHistoryRow,
} from '@repositories/daily-session/daily-sessions.repository';
import type {
  DailySessionHistoryItemDto,
  DailySessionHistoryResponseDto,
} from '../../interfaces/daily-session/daily-session-history.interface';

export enum ListDailySessionHistoryErrorCode {
  INVALID_INPUT = 'invalid_input',
}

export class ListDailySessionHistoryError extends Error {
  constructor(
    message: string,
    readonly code: ListDailySessionHistoryErrorCode,
  ) {
    super(message);
    this.name = 'ListDailySessionHistoryError';
  }
}

/** Raw query-string values — everything API Gateway hands the controller is a string or undefined. */
export interface ListDailySessionHistoryRawQuery {
  page?: string;
  pageSize?: string;
}

export interface DailySessionsHistoryRepositoryPort {
  listHistoryByUser(filters: {
    userId: string;
    page: number;
    pageSize: number;
  }): Promise<ListDailySessionHistoryResult>;
}

export interface ListDailySessionHistoryServiceDeps {
  repository: DailySessionsHistoryRepositoryPort;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
// Bounds the second query's `IN (:...sessionIds)` list too — see
// DailySessionsRepository.listHistoryByUser.
const MAX_PAGE_SIZE = 50;
const POSITIVE_INTEGER = /^\d+$/;

function invalidInput(message: string): never {
  throw new ListDailySessionHistoryError(message, ListDailySessionHistoryErrorCode.INVALID_INPUT);
}

/** Mirrors ListPracticeAttemptHistoryService.parsePositiveInt — same query-string contract. */
function parsePositiveInt(value: string | undefined, fieldName: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!POSITIVE_INTEGER.test(value)) invalidInput(`${fieldName} must be a positive integer`);
  const parsed = Number(value);
  if (parsed < 1) invalidInput(`${fieldName} must be a positive integer`);
  return parsed;
}

/** numeric(5,2) columns arrive from pg as strings; null stays null. */
function toNullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Paginated list of a user's past Daily Sessions. Pure read — deliberately
 * takes only a repository, no LLM and no Knowledge Base client, so its Lambda
 * bundle stays free of the generation dependencies (see
 * list-daily-session-history-composition.ts).
 */
export class ListDailySessionHistoryService {
  constructor(private readonly deps: ListDailySessionHistoryServiceDeps) {}

  async execute(
    userId: string,
    rawQuery: ListDailySessionHistoryRawQuery,
  ): Promise<DailySessionHistoryResponseDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');

    const page = parsePositiveInt(rawQuery.page, 'page', DEFAULT_PAGE);
    const pageSize = parsePositiveInt(rawQuery.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
    if (pageSize > MAX_PAGE_SIZE) invalidInput(`pageSize must be at most ${MAX_PAGE_SIZE}`);

    const { rows, totalItems } = await this.deps.repository.listHistoryByUser({
      userId,
      page,
      pageSize,
    });

    return {
      items: rows.map(toItemDto),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
    };
  }
}

/**
 * Scores are surfaced only for a GRADED submission. An in-progress or
 * abandoned one carries no result columns (enforced by
 * chk_daily_session_submissions_in_progress_has_no_result), so reporting them
 * as 0 rather than null would read as "scored zero" on the history card.
 */
function toItemDto(row: DailySessionHistoryRow): DailySessionHistoryItemDto {
  const { submission } = row;
  const isGraded = submission?.status === DailySessionSubmissionStatus.GRADED;

  return {
    sessionId: row.sessionId,
    sessionDate: row.sessionDate,
    topic: row.topic,
    readingTitle: row.readingTitle,
    targetLevel: row.targetLevel,
    itemCount: row.itemCount,
    createdAt: row.createdAt,

    submissionId: submission?.submissionId ?? null,
    submissionStatus: submission?.status ?? null,
    startedAt: submission?.startedAt ?? null,
    submittedAt: submission?.submittedAt ?? null,
    durationSeconds: submission?.durationSeconds ?? null,
    comprehensionCorrectCount: isGraded ? submission.comprehensionCorrectCount : null,
    comprehensionTotalCount: isGraded ? submission.comprehensionTotalCount : null,
    comprehensionPercentage: isGraded
      ? toNullableNumber(submission.comprehensionPercentage)
      : null,
    sentenceCorrectCount: isGraded ? (submission.sentenceFeedback?.correctCount ?? null) : null,
    sentenceTotalCount: isGraded ? (submission.sentenceFeedback?.totalCount ?? null) : null,
  };
}
