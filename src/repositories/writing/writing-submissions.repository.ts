import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { WritingSubmission } from '@models/WritingSubmission';
import { WritingTask } from '@models/WritingTask';
import { WritingSubmissionStatus, WritingTaskType } from '@models/enums';
import type { WritingFeedback } from '@models/writing-json-types';

interface CreateSubmissionData {
  userId: string;
  taskId: string;
  startedAt: Date;
  planDayId: string | null;
}

interface GradeSubmissionData {
  submittedAt: Date;
  durationSeconds: number;
  submittedText: string;
  wordCount: number;
  feedback: WritingFeedback;
}

interface ListHistoryFilters {
  userId: string;
  statuses: WritingSubmissionStatus[];
  page: number;
  pageSize: number;
}

interface WritingSubmissionHistoryRow {
  submissionId: string;
  taskId: string;
  taskType: WritingTaskType;
  title: string;
  status: WritingSubmissionStatus;
  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | null;
  wordCount: number | null;
  overallBand: number | null;
  maxBand: number | null;
}

interface ListHistoryResult {
  rows: WritingSubmissionHistoryRow[];
  totalItems: number;
}

interface WritingSubmissionHistoryRawRow {
  submissionId: string;
  taskId: string;
  taskType: WritingTaskType;
  title: string;
  status: WritingSubmissionStatus;
  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | null;
  wordCount: number | null;
  overallBand: string | null;
  maxBand: string | null;
}

function toHistoryRow(raw: WritingSubmissionHistoryRawRow): WritingSubmissionHistoryRow {
  return {
    submissionId: raw.submissionId,
    taskId: raw.taskId,
    taskType: raw.taskType,
    title: raw.title,
    status: raw.status,
    startedAt: raw.startedAt,
    submittedAt: raw.submittedAt,
    durationSeconds: raw.durationSeconds,
    wordCount: raw.wordCount,
    overallBand: raw.overallBand !== null ? parseFloat(raw.overallBand) : null,
    maxBand: raw.maxBand !== null ? parseFloat(raw.maxBand) : null,
  };
}

class WritingSubmissionsRepository {
  private readonly submissionRepo: Repository<WritingSubmission>;

  constructor(dataSource: DataSource | EntityManager) {
    this.submissionRepo = dataSource.getRepository(WritingSubmission);
  }

  async createSubmission(data: CreateSubmissionData): Promise<WritingSubmission> {
    const submission = this.submissionRepo.create({
      user_id: data.userId,
      task_id: data.taskId,
      status: WritingSubmissionStatus.IN_PROGRESS,
      started_at: data.startedAt,
      submitted_at: null,
      duration_seconds: null,
      submitted_text: null,
      word_count: null,
      feedback: null,
      plan_day_id: data.planDayId,
    });
    return this.submissionRepo.save(submission);
  }

  async findByIdForUser(submissionId: string, userId: string): Promise<WritingSubmission | null> {
    return this.submissionRepo
      .createQueryBuilder('submission')
      .where('submission.id = :submissionId', { submissionId })
      .andWhere('submission.user_id = :userId', { userId })
      .andWhere('submission.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Locks the row with SELECT ... FOR UPDATE. Requires a transactional
   * EntityManager (from dataSource.transaction(async manager => {...})) —
   * TypeORM throws at runtime if called outside an active transaction. Does
   * not filter by status — the caller decides what to do based on the
   * status it finds (in_progress/graded/abandoned).
   */
  async findByIdForUpdate(
    submissionId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<WritingSubmission | null> {
    return manager
      .getRepository(WritingSubmission)
      .createQueryBuilder('submission')
      .setLock('pessimistic_write')
      .where('submission.id = :submissionId', { submissionId })
      .andWhere('submission.user_id = :userId', { userId })
      .andWhere('submission.deleted_at IS NULL')
      .getOne();
  }

  async findActiveByUser(userId: string): Promise<WritingSubmission | null> {
    return this.submissionRepo
      .createQueryBuilder('submission')
      .where('submission.user_id = :userId', { userId })
      .andWhere('submission.status = :status', { status: WritingSubmissionStatus.IN_PROGRESS })
      .andWhere('submission.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Never includes 'in_progress' submissions — those are "active", already
   * served by findActiveByUser/GET /writing/submissions/active. Uses
   * .offset()/.limit() rather than .skip()/.take(): TypeORM silently ignores
   * skip/take whenever the query has a registered join (same gotcha as
   * PracticeAttemptsRepository.listHistoryByUser).
   */
  async listHistoryByUser(filters: ListHistoryFilters): Promise<ListHistoryResult> {
    const qb = this.submissionRepo
      .createQueryBuilder('submission')
      .innerJoin(WritingTask, 'task', 'task.id = submission.task_id AND task.deleted_at IS NULL')
      .where('submission.user_id = :userId', { userId: filters.userId })
      .andWhere('submission.deleted_at IS NULL')
      .andWhere('submission.status IN (:...statuses)', { statuses: filters.statuses });

    const totalItems = await qb.getCount();

    const raw = await qb
      .select('submission.id', 'submissionId')
      .addSelect('submission.task_id', 'taskId')
      .addSelect('task.task_type', 'taskType')
      .addSelect('task.title', 'title')
      .addSelect('submission.status', 'status')
      .addSelect('submission.started_at', 'startedAt')
      .addSelect('submission.submitted_at', 'submittedAt')
      .addSelect('submission.duration_seconds', 'durationSeconds')
      .addSelect('submission.word_count', 'wordCount')
      .addSelect("submission.feedback->>'overallBand'", 'overallBand')
      .addSelect("submission.feedback->>'maxBand'", 'maxBand')
      .orderBy('submission.submitted_at', 'DESC', 'NULLS LAST')
      .addOrderBy('submission.started_at', 'DESC')
      .offset((filters.page - 1) * filters.pageSize)
      .limit(filters.pageSize)
      .getRawMany<WritingSubmissionHistoryRawRow>();

    return { rows: raw.map(toHistoryRow), totalItems };
  }

  /** Only transitions a submission that is still 'in_progress' (avoids grading twice). */
  async gradeSubmission(
    submissionId: string,
    userId: string,
    data: GradeSubmissionData,
    manager: EntityManager,
  ): Promise<UpdateResult> {
    return manager.getRepository(WritingSubmission).update(
      {
        id: submissionId,
        user_id: userId,
        status: WritingSubmissionStatus.IN_PROGRESS,
        deleted_at: IsNull(),
      },
      {
        status: WritingSubmissionStatus.GRADED,
        submitted_at: data.submittedAt,
        duration_seconds: data.durationSeconds,
        submitted_text: data.submittedText,
        word_count: data.wordCount,
        feedback: data.feedback,
      },
    );
  }

  /** Only transitions a submission that is still 'in_progress'. */
  async abandonSubmission(submissionId: string, userId: string): Promise<UpdateResult> {
    return this.submissionRepo.update(
      {
        id: submissionId,
        user_id: userId,
        status: WritingSubmissionStatus.IN_PROGRESS,
        deleted_at: IsNull(),
      },
      { status: WritingSubmissionStatus.ABANDONED },
    );
  }
}

export { WritingSubmissionsRepository };
export type {
  CreateSubmissionData,
  GradeSubmissionData,
  ListHistoryFilters,
  WritingSubmissionHistoryRow,
  ListHistoryResult,
};
