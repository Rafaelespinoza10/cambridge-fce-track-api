import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { PracticeAttempt } from '../models/PracticeAttempt';
import { PracticeAttemptStatus } from '../models/enums';
import type { PracticeAttemptFeedbackSummary } from '../models/practice-json-types';

interface CreateAttemptData {
  userId: string;
  exerciseId: string;
  startedAt: Date;
  totalCount: number;
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
   * No pagination yet (no consumer). Adding `limit`/`offset` later is
   * additive — this signature won't need to break to support it.
   */
  async listHistoryByUser(userId: string): Promise<PracticeAttempt[]> {
    return this.attemptRepo
      .createQueryBuilder('attempt')
      .where('attempt.user_id = :userId', { userId })
      .andWhere('attempt.deleted_at IS NULL')
      .orderBy('attempt.started_at', 'DESC')
      .addOrderBy('attempt.id', 'ASC')
      .getMany();
  }
}

export { PracticeAttemptsRepository };
export type { CreateAttemptData, CompleteAttemptData };
