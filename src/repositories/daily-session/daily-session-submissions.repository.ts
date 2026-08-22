import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { DailySessionSubmission } from '@models/DailySessionSubmission';
import { DailySessionSubmissionStatus } from '@models/enums';
import type {
  DailySessionComprehensionAnswerRecord,
  DailySessionSentenceSubmission,
  DailySessionSentenceFeedback,
} from '@models/daily-session-json-types';

interface CreateSubmissionData {
  userId: string;
  dailySessionId: string;
  startedAt: Date;
}

interface GradeSubmissionData {
  submittedAt: Date;
  durationSeconds: number;
  comprehensionAnswers: DailySessionComprehensionAnswerRecord[];
  comprehensionCorrectCount: number;
  comprehensionTotalCount: number;
  comprehensionPercentage: number;
  sentenceSubmissions: DailySessionSentenceSubmission[];
  sentenceFeedback: DailySessionSentenceFeedback;
}

class DailySessionSubmissionsRepository {
  private readonly submissionRepo: Repository<DailySessionSubmission>;

  constructor(dataSource: DataSource | EntityManager) {
    this.submissionRepo = dataSource.getRepository(DailySessionSubmission);
  }

  async createSubmission(data: CreateSubmissionData): Promise<DailySessionSubmission> {
    const submission = this.submissionRepo.create({
      user_id: data.userId,
      daily_session_id: data.dailySessionId,
      status: DailySessionSubmissionStatus.IN_PROGRESS,
      started_at: data.startedAt,
      submitted_at: null,
      duration_seconds: null,
      comprehension_answers: null,
      comprehension_correct_count: null,
      comprehension_total_count: null,
      comprehension_percentage: null,
      sentence_submissions: null,
      sentence_feedback: null,
    });
    return this.submissionRepo.save(submission);
  }

  /**
   * A session has at most one submission ever, regardless of status (see
   * uq_daily_session_submissions_session) — this is the "get" half of
   * StartDailySessionSubmissionService's get-or-create.
   */
  async findByDailySessionIdForUser(
    dailySessionId: string,
    userId: string,
  ): Promise<DailySessionSubmission | null> {
    return this.submissionRepo
      .createQueryBuilder('submission')
      .where('submission.daily_session_id = :dailySessionId', { dailySessionId })
      .andWhere('submission.user_id = :userId', { userId })
      .andWhere('submission.deleted_at IS NULL')
      .getOne();
  }

  async findByIdForUser(submissionId: string, userId: string): Promise<DailySessionSubmission | null> {
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
  ): Promise<DailySessionSubmission | null> {
    return manager
      .getRepository(DailySessionSubmission)
      .createQueryBuilder('submission')
      .setLock('pessimistic_write')
      .where('submission.id = :submissionId', { submissionId })
      .andWhere('submission.user_id = :userId', { userId })
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
    return manager.getRepository(DailySessionSubmission).update(
      {
        id: submissionId,
        user_id: userId,
        status: DailySessionSubmissionStatus.IN_PROGRESS,
        deleted_at: IsNull(),
      },
      {
        status: DailySessionSubmissionStatus.GRADED,
        submitted_at: data.submittedAt,
        duration_seconds: data.durationSeconds,
        comprehension_answers: data.comprehensionAnswers,
        comprehension_correct_count: data.comprehensionCorrectCount,
        comprehension_total_count: data.comprehensionTotalCount,
        comprehension_percentage: String(data.comprehensionPercentage),
        sentence_submissions: data.sentenceSubmissions,
        sentence_feedback: data.sentenceFeedback,
      },
    );
  }
}

export { DailySessionSubmissionsRepository };
export type { CreateSubmissionData, GradeSubmissionData };
