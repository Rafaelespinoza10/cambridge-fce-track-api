import { WritingSubmissionStatus } from '../../models/enums';
import type {
  ListHistoryResult,
  WritingSubmissionHistoryRow,
} from '@repositories/writing/writing-submissions.repository';
import type {
  WritingSubmissionHistoryItemDto,
  WritingSubmissionHistoryResponseDto,
} from '../../interfaces/writing/writing-submission-history.interface';

export enum ListWritingSubmissionHistoryErrorCode {
  INVALID_INPUT = 'invalid_input',
}

export class ListWritingSubmissionHistoryError extends Error {
  constructor(
    message: string,
    readonly code: ListWritingSubmissionHistoryErrorCode,
  ) {
    super(message);
    this.name = 'ListWritingSubmissionHistoryError';
  }
}

/** Raw query-string values — everything API Gateway hands the controller is a string or undefined. */
export interface ListWritingSubmissionHistoryRawQuery {
  status?: string;
  page?: string;
  pageSize?: string;
}

export interface WritingSubmissionsRepositoryPort {
  listHistoryByUser(filters: {
    userId: string;
    statuses: WritingSubmissionStatus[];
    page: number;
    pageSize: number;
  }): Promise<ListHistoryResult>;
}

export interface ListWritingSubmissionHistoryServiceDeps {
  repository: WritingSubmissionsRepositoryPort;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const VALID_STATUS_FILTERS = new Set(['graded', 'abandoned', 'all']);
const POSITIVE_INTEGER = /^\d+$/;

function invalidInput(message: string): never {
  throw new ListWritingSubmissionHistoryError(
    message,
    ListWritingSubmissionHistoryErrorCode.INVALID_INPUT,
  );
}

function parsePositiveInt(value: string | undefined, fieldName: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!POSITIVE_INTEGER.test(value)) invalidInput(`${fieldName} must be a positive integer`);
  const parsed = Number(value);
  if (parsed < 1) invalidInput(`${fieldName} must be a positive integer`);
  return parsed;
}

function resolveStatuses(status: 'graded' | 'abandoned' | 'all'): WritingSubmissionStatus[] {
  if (status === 'graded') return [WritingSubmissionStatus.GRADED];
  if (status === 'abandoned') return [WritingSubmissionStatus.ABANDONED];
  return [WritingSubmissionStatus.GRADED, WritingSubmissionStatus.ABANDONED];
}

/**
 * Validates filters/pagination, queries the repository, maps rows to the
 * safe history DTO, and computes totalPages. Knows nothing about API
 * Gateway or HTTP status codes — the controller maps this service's errors.
 * Mirrors ListPracticeAttemptHistoryService's shape, simplified (no
 * exam/paper/part catalog filters — Writing has no such hierarchy).
 */
export class ListWritingSubmissionHistoryService {
  constructor(private readonly deps: ListWritingSubmissionHistoryServiceDeps) {}

  async execute(
    userId: string,
    rawQuery: ListWritingSubmissionHistoryRawQuery,
  ): Promise<WritingSubmissionHistoryResponseDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');

    const statusFilter = rawQuery.status ?? 'all';
    if (!VALID_STATUS_FILTERS.has(statusFilter)) {
      invalidInput('status must be one of: graded, abandoned, all');
    }

    const page = parsePositiveInt(rawQuery.page, 'page', DEFAULT_PAGE);

    const pageSize = parsePositiveInt(rawQuery.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
    if (pageSize > MAX_PAGE_SIZE) {
      invalidInput(`pageSize must be at most ${MAX_PAGE_SIZE}`);
    }

    const statuses = resolveStatuses(statusFilter as 'graded' | 'abandoned' | 'all');

    const { rows, totalItems } = await this.deps.repository.listHistoryByUser({
      userId,
      statuses,
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

function toItemDto(row: WritingSubmissionHistoryRow): WritingSubmissionHistoryItemDto {
  return {
    submissionId: row.submissionId,
    taskId: row.taskId,
    taskType: row.taskType,
    title: row.title,
    status: row.status as WritingSubmissionHistoryItemDto['status'],
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    durationSeconds: row.durationSeconds,
    wordCount: row.wordCount,
    overallBand: row.overallBand,
    maxBand: row.maxBand,
  };
}
