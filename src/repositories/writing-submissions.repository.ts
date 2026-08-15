import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { WritingSubmission } from '../models/WritingSubmission';
import { WritingSubmissionStatus } from '../models/enums';
import type { WritingFeedback } from '../models/writing-json-types';

interface CreateSubmissionData {
  userId: string;
  taskId: string;
  startedAt: Date;
}

interface GradeSubmissionData {
  submittedAt: Date;
  durationSeconds: number;
  submittedText: string;
  wordCount: number;
  feedback: WritingFeedback;
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
export type { CreateSubmissionData, GradeSubmissionData };
