import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { PracticeAttempt } from '../models/PracticeAttempt';
import { PracticeExercise } from '../models/PracticeExercise';
import { PracticeAttemptStatus } from '../models/enums';
import type { EnglishLevel } from '../models/enums';
import type { PracticeAttemptFeedbackSummary } from '../models/practice-json-types';
import { toNullableNumber, toRequiredNumber } from '../lib/pg-numeric';

/** Never IN_PROGRESS — the history listing only ever shows finished attempts. */
type PracticeAttemptHistoryStatusFilter =
  | PracticeAttemptStatus.COMPLETED
  | PracticeAttemptStatus.ABANDONED;

interface ListPracticeAttemptHistoryFilters {
  userId: string;
  statuses: PracticeAttemptHistoryStatusFilter[];
  examCode?: string;
  paperCode?: string;
  partCode?: string;
  page: number;
  pageSize: number;
}

/** Flat projection — attempt scalars + just enough PracticeExercise metadata to filter/display. Never PracticeItems/PracticeAnswers/answer keys. */
interface PracticeAttemptHistoryRow {
  attemptId: string;
  exerciseId: string;
  status: PracticeAttemptHistoryStatusFilter;
  examCode: string;
  paperCode: string;
  partCode: string;
  targetLevel: EnglishLevel | null;
  title: string;
  itemCount: number;
  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | null;
  correctCount: number | null;
  totalCount: number;
  percentage: number | null;
  feedbackSummary: PracticeAttemptFeedbackSummary | null;
}

interface ListPracticeAttemptHistoryResult {
  rows: PracticeAttemptHistoryRow[];
  totalItems: number;
}

/**
 * The raw shape `getRawMany()` actually hands back, before any type
 * normalization. Every numeric-ish column is typed as `number | string`
 * (or nullable variants) here on purpose — node-postgres returns `integer`
 * columns as `number` but `numeric`/`decimal` columns (percentage) as
 * `string`, and nothing about a raw query builder result enforces either
 * shape. `toHistoryRow` is the one place that resolves the ambiguity.
 */
interface PracticeAttemptHistoryRawRow {
  attemptId: string;
  exerciseId: string;
  status: PracticeAttemptHistoryStatusFilter;
  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | string | null;
  correctCount: number | string | null;
  totalCount: number | string;
  percentage: number | string | null;
  feedbackSummary: PracticeAttemptFeedbackSummary | null;
  examCode: string;
  paperCode: string;
  partCode: string;
  targetLevel: EnglishLevel | null;
  title: string;
  itemCount: number | string;
}

/**
 * Exported only for the raw->row type-normalization regression test
 * (`practice-attempts.repository.test.ts`) — never used outside this file
 * otherwise. Every numeric-ish field is converted explicitly via
 * `toNullableNumber`/`toRequiredNumber`, never left to whatever shape the
 * driver happened to hand back; `null` is always preserved as `null`.
 * `startedAt`/`submittedAt` are left untouched — node-postgres already
 * parses `timestamptz` into real `Date` objects, and the HTTP layer relies
 * on `JSON.stringify`'s own `Date -> ISO string` serialization.
 */
function toHistoryRow(raw: PracticeAttemptHistoryRawRow): PracticeAttemptHistoryRow {
  return {
    attemptId: raw.attemptId,
    exerciseId: raw.exerciseId,
    status: raw.status,
    examCode: raw.examCode,
    paperCode: raw.paperCode,
    partCode: raw.partCode,
    targetLevel: raw.targetLevel,
    title: raw.title,
    itemCount: toRequiredNumber(raw.itemCount),
    startedAt: raw.startedAt,
    submittedAt: raw.submittedAt,
    durationSeconds: toNullableNumber(raw.durationSeconds),
    correctCount: toNullableNumber(raw.correctCount),
    totalCount: toRequiredNumber(raw.totalCount),
    percentage: toNullableNumber(raw.percentage),
    feedbackSummary: raw.feedbackSummary,
  };
}

interface CreateAttemptData {
  userId: string;
  exerciseId: string;
  startedAt: Date;
  totalCount: number;
  planDayId: string | null;
}

interface CompleteAttemptData {
  submittedAt: Date;
  durationSeconds: number;
  correctCount: number;
  percentage: number;
  feedbackSummary: PracticeAttemptFeedbackSummary | null;
}

class PracticeAttemptsRepository {
  private readonly attemptRepo: Repository<PracticeAttempt>;

  constructor(dataSource: DataSource | EntityManager) {
    this.attemptRepo = dataSource.getRepository(PracticeAttempt);
  }

  async createAttempt(data: CreateAttemptData): Promise<PracticeAttempt> {
    const attempt = this.attemptRepo.create({
      user_id: data.userId,
      exercise_id: data.exerciseId,
      status: PracticeAttemptStatus.IN_PROGRESS,
      started_at: data.startedAt,
      submitted_at: null,
      duration_seconds: null,
      correct_count: null,
      total_count: data.totalCount,
      percentage: null,
      feedback_summary: null,
      plan_day_id: data.planDayId,
    });
    return this.attemptRepo.save(attempt);
  }

  async findByIdForUser(attemptId: string, userId: string): Promise<PracticeAttempt | null> {
    return this.attemptRepo
      .createQueryBuilder('attempt')
      .where('attempt.id = :attemptId', { attemptId })
      .andWhere('attempt.user_id = :userId', { userId })
      .andWhere('attempt.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Bloquea la fila con SELECT ... FOR UPDATE. Requiere un EntityManager
   * transaccional (obtenido de dataSource.transaction(async manager => {...})) —
   * TypeORM lanza en runtime si se invoca fuera de una transacción activa. No
   * filtra por status: el caller decide qué hacer según el estado que
   * encuentre (in_progress/completed/abandoned).
   */
  async findByIdForUpdate(
    attemptId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<PracticeAttempt | null> {
    return manager
      .getRepository(PracticeAttempt)
      .createQueryBuilder('attempt')
      .setLock('pessimistic_write')
      .where('attempt.id = :attemptId', { attemptId })
      .andWhere('attempt.user_id = :userId', { userId })
      .andWhere('attempt.deleted_at IS NULL')
      .getOne();
  }

  async findActiveByUser(userId: string): Promise<PracticeAttempt | null> {
    return this.attemptRepo
      .createQueryBuilder('attempt')
      .where('attempt.user_id = :userId', { userId })
      .andWhere('attempt.status = :status', { status: PracticeAttemptStatus.IN_PROGRESS })
      .andWhere('attempt.deleted_at IS NULL')
      .getOne();
  }

  /** Only transitions an attempt that is still 'in_progress' (evita completar dos veces). */
  async completeAttempt(
    attemptId: string,
    userId: string,
    data: CompleteAttemptData,
  ): Promise<UpdateResult> {
    return this.attemptRepo.update(
      {
        id: attemptId,
        user_id: userId,
        status: PracticeAttemptStatus.IN_PROGRESS,
        deleted_at: IsNull(),
      },
      {
        status: PracticeAttemptStatus.COMPLETED,
        submitted_at: data.submittedAt,
        duration_seconds: data.durationSeconds,
        correct_count: data.correctCount,
        percentage: String(data.percentage),
        feedback_summary: data.feedbackSummary,
      },
    );
  }

  /** Only transitions an attempt that is still 'in_progress'. */
  async abandonAttempt(attemptId: string, userId: string): Promise<UpdateResult> {
    return this.attemptRepo.update(
      {
        id: attemptId,
        user_id: userId,
        status: PracticeAttemptStatus.IN_PROGRESS,
        deleted_at: IsNull(),
      },
      { status: PracticeAttemptStatus.ABANDONED },
    );
  }

  /**
   * Filtered, paginated history of finished (completed/abandoned) attempts.
   * Joins PracticeExercise only for filtering/display metadata — never loads
   * PracticeItems/PracticeAnswers/answer keys. A raw, hand-selected
   * projection (not `getMany()`) keeps this to exactly the columns the
   * history DTO needs, and means an exercise's `answer_key`/`explanation`
   * (already `select: false` at the column level) are never even in the
   * query's reach.
   *
   * The exercise join filters `deleted_at IS NULL` — an attempt whose
   * exercise was independently soft-deleted silently drops out of the
   * history list, the same "exercise not found" semantics every other
   * exercise-touching query in this repository already applies.
   */
  async listHistoryByUser(
    filters: ListPracticeAttemptHistoryFilters,
  ): Promise<ListPracticeAttemptHistoryResult> {
    const qb = this.attemptRepo
      .createQueryBuilder('attempt')
      .innerJoin(
        PracticeExercise,
        'exercise',
        'exercise.id = attempt.exercise_id AND exercise.deleted_at IS NULL',
      )
      .where('attempt.user_id = :userId', { userId: filters.userId })
      .andWhere('attempt.deleted_at IS NULL')
      .andWhere('attempt.status IN (:...statuses)', { statuses: filters.statuses });

    if (filters.examCode !== undefined) {
      qb.andWhere('exercise.exam_code = :examCode', { examCode: filters.examCode });
    }
    if (filters.paperCode !== undefined) {
      qb.andWhere('exercise.paper_code = :paperCode', { paperCode: filters.paperCode });
    }
    if (filters.partCode !== undefined) {
      qb.andWhere('exercise.part_code = :partCode', { partCode: filters.partCode });
    }

    // getCount() clones the builder internally before overriding SELECT, so
    // it never mutates `qb` — safe to keep building on the same instance.
    const totalItems = await qb.getCount();

    const raw = await qb
      .select('attempt.id', 'attemptId')
      .addSelect('attempt.exercise_id', 'exerciseId')
      .addSelect('attempt.status', 'status')
      .addSelect('attempt.started_at', 'startedAt')
      .addSelect('attempt.submitted_at', 'submittedAt')
      .addSelect('attempt.duration_seconds', 'durationSeconds')
      .addSelect('attempt.correct_count', 'correctCount')
      .addSelect('attempt.total_count', 'totalCount')
      .addSelect('attempt.percentage', 'percentage')
      .addSelect('attempt.feedback_summary', 'feedbackSummary')
      .addSelect('exercise.exam_code', 'examCode')
      .addSelect('exercise.paper_code', 'paperCode')
      .addSelect('exercise.part_code', 'partCode')
      .addSelect('exercise.target_level', 'targetLevel')
      .addSelect('exercise.title', 'title')
      .addSelect('exercise.item_count', 'itemCount')
      .orderBy('attempt.started_at', 'DESC')
      .addOrderBy('attempt.id', 'ASC')
      // `.skip()/.take()` are silently ignored by TypeORM whenever the query
      // has a registered join (`createLimitOffsetExpression` only falls back
      // to them when `joinAttributes.length === 0`) — `.offset()/.limit()`
      // are read unconditionally, so those are the ones that actually apply
      // here given the join to `practice_exercises` above.
      .offset((filters.page - 1) * filters.pageSize)
      .limit(filters.pageSize)
      .getRawMany<PracticeAttemptHistoryRawRow>();

    return { rows: raw.map(toHistoryRow), totalItems };
  }
}

export { PracticeAttemptsRepository, toHistoryRow };
export type { CreateAttemptData, CompleteAttemptData };
export type {
  PracticeAttemptHistoryStatusFilter,
  ListPracticeAttemptHistoryFilters,
  PracticeAttemptHistoryRow,
  ListPracticeAttemptHistoryResult,
  PracticeAttemptHistoryRawRow,
};
