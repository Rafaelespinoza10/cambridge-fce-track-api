import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { ListeningAttempt } from '@models/ListeningAttempt';
import { ListeningAttemptStatus } from '@models/enums';
import type {
  ListeningAttemptAnswerEntry,
  ListeningAttemptFeedbackSummary,
} from '@models/listening-json-types';

export interface CreateListeningAttemptData {
  userId: string;
  sourceId: string;
  startedAt: Date;
  totalCount: number;
}

export interface CompleteListeningAttemptData {
  submittedAt: Date;
  durationSeconds: number;
  correctCount: number;
  percentage: number;
  answers: ListeningAttemptAnswerEntry[];
  feedbackSummary: ListeningAttemptFeedbackSummary | null;
}

class ListeningAttemptsRepository {
  private readonly attemptRepo: Repository<ListeningAttempt>;

  constructor(dataSource: DataSource | EntityManager) {
    this.attemptRepo = dataSource.getRepository(ListeningAttempt);
  }

  async createAttempt(data: CreateListeningAttemptData): Promise<ListeningAttempt> {
    const attempt = this.attemptRepo.create({
      user_id: data.userId,
      source_id: data.sourceId,
      status: ListeningAttemptStatus.IN_PROGRESS,
      started_at: data.startedAt,
      submitted_at: null,
      duration_seconds: null,
      correct_count: null,
      total_count: data.totalCount,
      percentage: null,
      answers: null,
      feedback_summary: null,
    });
    return this.attemptRepo.save(attempt);
  }

  async findByIdForUser(attemptId: string, userId: string): Promise<ListeningAttempt | null> {
    return this.attemptRepo
      .createQueryBuilder('attempt')
      .where('attempt.id = :attemptId', { attemptId })
      .andWhere('attempt.user_id = :userId', { userId })
      .andWhere('attempt.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Locks the row with SELECT ... FOR UPDATE. Requires a transactional
   * EntityManager (from dataSource.transaction(async manager => {...})) —
   * TypeORM throws at runtime if called outside an active transaction.
   * Doesn't filter by status: the caller decides what to do based on
   * whatever state it finds (in_progress/completed).
   */
  async findByIdForUpdate(
    attemptId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<ListeningAttempt | null> {
    return manager
      .getRepository(ListeningAttempt)
      .createQueryBuilder('attempt')
      .setLock('pessimistic_write')
      .where('attempt.id = :attemptId', { attemptId })
      .andWhere('attempt.user_id = :userId', { userId })
      .andWhere('attempt.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Only transitions an attempt that is still 'in_progress' (prevents
   * completing twice). Takes the transactional manager explicitly — this
   * write and the AI-linked planned_activity it creates (see
   * SubmitListeningAttemptService) must commit or roll back together, same
   * as Writing's gradeSubmission.
   */
  async completeAttempt(
    attemptId: string,
    userId: string,
    data: CompleteListeningAttemptData,
    manager: EntityManager,
  ): Promise<UpdateResult> {
    return manager.getRepository(ListeningAttempt).update(
      {
        id: attemptId,
        user_id: userId,
        status: ListeningAttemptStatus.IN_PROGRESS,
        deleted_at: IsNull(),
      },
      {
        status: ListeningAttemptStatus.COMPLETED,
        submitted_at: data.submittedAt,
        duration_seconds: data.durationSeconds,
        correct_count: data.correctCount,
        percentage: String(data.percentage),
        answers: data.answers,
        feedback_summary: data.feedbackSummary,
      },
    );
  }
}

export { ListeningAttemptsRepository };
