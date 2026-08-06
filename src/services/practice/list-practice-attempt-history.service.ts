import { PracticeAttemptStatus } from '../../models/enums';
import {
  isPracticeExamCode,
  isPracticePaperCode,
  isPracticePartCode,
} from '../../lib/practice-exam-catalog';
import { toNullableNumber } from '../../lib/pg-numeric';
import type {
  PracticeAttemptHistoryStatusFilter,
  PracticeAttemptHistoryRow,
  ListPracticeAttemptHistoryResult,
} from '../../repositories/practice-attempts.repository';
import type {
  PracticeAttemptHistoryItemDto,
  PracticeAttemptHistoryResponseDto,
} from '../../interfaces/practice/practice-attempt-history.interface';

export enum ListPracticeAttemptHistoryErrorCode {
  INVALID_INPUT = 'invalid_input',
  UNSUPPORTED_EXAM = 'unsupported_exam',
  UNSUPPORTED_PAPER = 'unsupported_paper',
  UNSUPPORTED_PART = 'unsupported_part',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class ListPracticeAttemptHistoryError extends Error {
  constructor(
    message: string,
    readonly code: ListPracticeAttemptHistoryErrorCode,
  ) {
    super(message);
    this.name = 'ListPracticeAttemptHistoryError';
  }
}

/** Raw query-string values — everything API Gateway hands the controller is a string or undefined. */
export interface ListPracticeAttemptHistoryRawQuery {
  status?: string;
  examCode?: string;
  paperCode?: string;
  partCode?: string;
  page?: string;
  pageSize?: string;
}

export interface PracticeAttemptsRepositoryPort {
  listHistoryByUser(filters: {
    userId: string;
    statuses: PracticeAttemptHistoryStatusFilter[];
    examCode?: string;
    paperCode?: string;
    partCode?: string;
    page: number;
    pageSize: number;
  }): Promise<ListPracticeAttemptHistoryResult>;
}

export interface ListPracticeAttemptHistoryServiceDeps {
  repository: PracticeAttemptsRepositoryPort;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const VALID_STATUS_FILTERS = new Set(['completed', 'abandoned', 'all']);
const POSITIVE_INTEGER = /^\d+$/;

function invalidInput(message: string): never {
  throw new ListPracticeAttemptHistoryError(
    message,
    ListPracticeAttemptHistoryErrorCode.INVALID_INPUT,
  );
}

function unsupportedExam(examCode: string): never {
  throw new ListPracticeAttemptHistoryError(
    `Unknown examCode "${examCode}"`,
    ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_EXAM,
  );
}

function unsupportedPaper(examCode: string, paperCode: string): never {
  throw new ListPracticeAttemptHistoryError(
    `Unknown paperCode "${paperCode}" for exam "${examCode}"`,
    ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PAPER,
  );
}

function unsupportedPart(paperCode: string, partCode: string): never {
  throw new ListPracticeAttemptHistoryError(
    `Unknown partCode "${partCode}" for paper "${paperCode}"`,
    ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PART,
  );
}

/** `page`/`pageSize` share the "positive integer" shape; the pageSize upper bound is checked separately by the caller. */
function parsePositiveInt(value: string | undefined, fieldName: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!POSITIVE_INTEGER.test(value)) invalidInput(`${fieldName} must be a positive integer`);
  const parsed = Number(value);
  if (parsed < 1) invalidInput(`${fieldName} must be a positive integer`);
  return parsed;
}

function resolveStatuses(
  status: 'completed' | 'abandoned' | 'all',
): PracticeAttemptHistoryStatusFilter[] {
  if (status === 'completed') return [PracticeAttemptStatus.COMPLETED];
  if (status === 'abandoned') return [PracticeAttemptStatus.ABANDONED];
  return [PracticeAttemptStatus.COMPLETED, PracticeAttemptStatus.ABANDONED];
}

/**
 * Validates filters/pagination/catalog, queries the repository, maps rows to
 * the safe history DTO, and computes totalPages. Knows nothing about API
 * Gateway or HTTP status codes — the controller maps this service's errors.
 */
export class ListPracticeAttemptHistoryService {
  constructor(private readonly deps: ListPracticeAttemptHistoryServiceDeps) {}

  async execute(
    userId: string,
    rawQuery: ListPracticeAttemptHistoryRawQuery,
  ): Promise<PracticeAttemptHistoryResponseDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');

    const statusFilter = rawQuery.status ?? 'all';
    if (!VALID_STATUS_FILTERS.has(statusFilter)) {
      invalidInput('status must be one of: completed, abandoned, all');
    }

    const page = parsePositiveInt(rawQuery.page, 'page', DEFAULT_PAGE);

    const pageSize = parsePositiveInt(rawQuery.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
    if (pageSize > MAX_PAGE_SIZE) {
      invalidInput(`pageSize must be at most ${MAX_PAGE_SIZE}`);
    }

    const { examCode, paperCode, partCode } = rawQuery;
    this.validateCatalogFilters(examCode, paperCode, partCode);

    const statuses = resolveStatuses(statusFilter as 'completed' | 'abandoned' | 'all');

    const { rows, totalItems } = await this.deps.repository.listHistoryByUser({
      userId,
      statuses,
      examCode,
      paperCode,
      partCode,
      page,
      pageSize,
    });

    return {
      items: rows.map((row) => this.toItemDto(row)),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
    };
  }

  private validateCatalogFilters(examCode?: string, paperCode?: string, partCode?: string): void {
    if (examCode !== undefined && !isPracticeExamCode(examCode)) {
      unsupportedExam(examCode);
    }

    if (paperCode !== undefined) {
      if (examCode === undefined) invalidInput('paperCode filter requires examCode');
      if (!isPracticePaperCode(examCode, paperCode)) unsupportedPaper(examCode, paperCode);
    }

    if (partCode !== undefined) {
      if (paperCode === undefined) invalidInput('partCode filter requires paperCode');
      // examCode is guaranteed defined here: paperCode !== undefined already
      // required examCode above, and partCode requires paperCode.
      if (!isPracticePartCode(examCode as string, paperCode, partCode)) {
        unsupportedPart(paperCode, partCode);
      }
    }
  }

  /**
   * A `completed` row missing any result field would violate
   * chk_practice_attempts_completed_has_result — unreachable against the
   * real schema, but fail loudly (PERSISTENCE_INCONSISTENCY) rather than
   * silently emitting a broken DTO.
   */
  private toItemDto(row: PracticeAttemptHistoryRow): PracticeAttemptHistoryItemDto {
    if (
      row.status === PracticeAttemptStatus.COMPLETED &&
      (row.correctCount === null ||
        row.percentage === null ||
        row.submittedAt === null ||
        row.durationSeconds === null)
    ) {
      throw new ListPracticeAttemptHistoryError(
        `Completed practice attempt ${row.attemptId} is missing its result fields`,
        ListPracticeAttemptHistoryErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    return {
      attemptId: row.attemptId,
      exerciseId: row.exerciseId,
      status: row.status,
      examCode: row.examCode,
      paperCode: row.paperCode,
      partCode: row.partCode,
      targetLevel: row.targetLevel,
      title: row.title,
      itemCount: row.itemCount,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
      durationSeconds: row.durationSeconds,
      correctCount: row.correctCount,
      totalCount: row.totalCount,
      percentage: row.percentage,
      // feedbackSummary is JSONB — its unansweredCount is typed `number`
      // already, but this crosses the same raw-Postgres boundary as the
      // other numeric fields, so it's normalized the same explicit way
      // rather than trusted implicitly.
      unansweredCount: toNullableNumber(row.feedbackSummary?.unansweredCount ?? null),
    };
  }
}
