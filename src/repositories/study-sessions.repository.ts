import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { StudySession } from '../models/StudySession';
import { StudySessionType, StudySessionStatus } from '../models/enums';

interface UpdateStudySessionProgressData {
  ended_at?: Date | null;
  duration_minutes?: number | null;
  status?: StudySessionStatus;
}

class StudySessionsRepository {
  private readonly sessionRepo: Repository<StudySession>;

  constructor(dataSource: DataSource | EntityManager) {
    this.sessionRepo = dataSource.getRepository(StudySession);
  }

  async createFlashcardSession(userId: string, startedAt: Date): Promise<StudySession> {
    const session = this.sessionRepo.create({
      user_id: userId,
      session_type: StudySessionType.FLASHCARD_REVIEW,
      status: StudySessionStatus.ACTIVE,
      started_at: startedAt,
    });
    return this.sessionRepo.save(session);
  }

  async findActiveFlashcardSessionByUser(userId: string): Promise<StudySession | null> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .where('session.user_id = :userId', { userId })
      .andWhere('session.session_type = :sessionType', {
        sessionType: StudySessionType.FLASHCARD_REVIEW,
      })
      .andWhere('session.status = :status', { status: StudySessionStatus.ACTIVE })
      .getOne();
  }

  async findByIdAndUser(studySessionId: string, userId: string): Promise<StudySession | null> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .where('session.id = :studySessionId', { studySessionId })
      .andWhere('session.user_id = :userId', { userId })
      .andWhere('session.session_type = :sessionType', {
        sessionType: StudySessionType.FLASHCARD_REVIEW,
      })
      .getOne();
  }

  async updateSessionProgress(
    studySessionId: string,
    userId: string,
    data: UpdateStudySessionProgressData,
  ): Promise<UpdateResult> {
    return this.sessionRepo.update(
      {
        id: studySessionId,
        user_id: userId,
        session_type: StudySessionType.FLASHCARD_REVIEW,
      },
      data,
    );
  }

  /** Solo transiciona una sesión que todavía esté 'active' (evita completar dos veces). */
  async markCompleted(
    studySessionId: string,
    userId: string,
    endedAt: Date,
    durationMinutes: number,
  ): Promise<UpdateResult> {
    return this.sessionRepo.update(
      {
        id: studySessionId,
        user_id: userId,
        session_type: StudySessionType.FLASHCARD_REVIEW,
        status: StudySessionStatus.ACTIVE,
      },
      {
        status: StudySessionStatus.COMPLETED,
        ended_at: endedAt,
        duration_minutes: durationMinutes,
      },
    );
  }
}

export { StudySessionsRepository };
export type { UpdateStudySessionProgressData };
