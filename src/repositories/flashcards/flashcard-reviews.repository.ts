import type { DataSource, EntityManager, Repository } from 'typeorm';
import { FlashcardReview } from '@models/FlashcardReview';
import type { ReviewRating, FlashcardStatus } from '@models/enums';

interface CreateFlashcardReviewData {
  userId: string;
  flashcardId: string;
  studySessionId: string;
  idempotencyKey: string;
  rating: ReviewRating;
  previousStatus: FlashcardStatus;
  newStatus: FlashcardStatus;
  previousNextReviewAt: Date;
  newNextReviewAt: Date;
  previousIntervalMinutes: number;
  newIntervalMinutes: number;
  previousEaseFactor: number;
  newEaseFactor: number;
  previousRepetitions: number;
  newRepetitions: number;
  previousLapses: number;
  newLapses: number;
  responseTimeMs: number | null;
  reviewedAt: Date;
}

class FlashcardReviewsRepository {
  private readonly reviewRepo: Repository<FlashcardReview>;

  constructor(dataSource: DataSource | EntityManager) {
    this.reviewRepo = dataSource.getRepository(FlashcardReview);
  }

  async createReview(data: CreateFlashcardReviewData): Promise<FlashcardReview> {
    const review = this.reviewRepo.create({
      user_id: data.userId,
      flashcard_id: data.flashcardId,
      study_session_id: data.studySessionId,
      idempotency_key: data.idempotencyKey,
      rating: data.rating,
      previous_status: data.previousStatus,
      new_status: data.newStatus,
      previous_next_review_at: data.previousNextReviewAt,
      new_next_review_at: data.newNextReviewAt,
      previous_interval_minutes: data.previousIntervalMinutes,
      new_interval_minutes: data.newIntervalMinutes,
      previous_ease_factor: String(data.previousEaseFactor),
      new_ease_factor: String(data.newEaseFactor),
      previous_repetitions: data.previousRepetitions,
      new_repetitions: data.newRepetitions,
      previous_lapses: data.previousLapses,
      new_lapses: data.newLapses,
      response_time_ms: data.responseTimeMs,
      reviewed_at: data.reviewedAt,
    });
    return this.reviewRepo.save(review);
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<FlashcardReview | null> {
    return this.reviewRepo.findOne({ where: { user_id: userId, idempotency_key: idempotencyKey } });
  }

  async findBySession(studySessionId: string, userId: string): Promise<FlashcardReview[]> {
    return this.reviewRepo.find({
      where: { study_session_id: studySessionId, user_id: userId },
      order: { reviewed_at: 'ASC' },
    });
  }

  async findByFlashcard(flashcardId: string, userId: string): Promise<FlashcardReview[]> {
    return this.reviewRepo.find({
      where: { flashcard_id: flashcardId, user_id: userId },
      order: { reviewed_at: 'ASC' },
    });
  }

  async findLatestByFlashcard(
    flashcardId: string,
    userId: string,
  ): Promise<FlashcardReview | null> {
    return this.reviewRepo.findOne({
      where: { flashcard_id: flashcardId, user_id: userId },
      order: { reviewed_at: 'DESC' },
    });
  }

  async findByUserAndDateRange(userId: string, from: Date, to: Date): Promise<FlashcardReview[]> {
    return this.reviewRepo
      .createQueryBuilder('review')
      .where('review.user_id = :userId', { userId })
      .andWhere('review.reviewed_at >= :from', { from })
      .andWhere('review.reviewed_at <= :to', { to })
      .orderBy('review.reviewed_at', 'DESC')
      .getMany();
  }

  async countBySession(studySessionId: string, userId: string): Promise<number> {
    return this.reviewRepo.count({ where: { study_session_id: studySessionId, user_id: userId } });
  }

  /**
   * `reviewed_at` no es único, así que se ordena también por `id DESC` como
   * criterio de desempate estable (no cronológico, solo determinista).
   */
  async findLatestBySession(
    studySessionId: string,
    userId: string,
  ): Promise<FlashcardReview | null> {
    return this.reviewRepo
      .createQueryBuilder('review')
      .where('review.study_session_id = :studySessionId', { studySessionId })
      .andWhere('review.user_id = :userId', { userId })
      .orderBy('review.reviewed_at', 'DESC')
      .addOrderBy('review.id', 'DESC')
      .getOne();
  }

  /**
   * ¿Ya existe un review de esta tarjeta dentro del rango [dayStartedAt, dayEndedAt)?
   * El rango del día local lo calcula el caller (no hay lógica de timezone aquí).
   */
  async existsForFlashcardOnDate(
    userId: string,
    flashcardId: string,
    dayStartedAt: Date,
    dayEndedAt: Date,
  ): Promise<boolean> {
    const count = await this.reviewRepo
      .createQueryBuilder('review')
      .where('review.user_id = :userId', { userId })
      .andWhere('review.flashcard_id = :flashcardId', { flashcardId })
      .andWhere('review.reviewed_at >= :dayStartedAt', { dayStartedAt })
      .andWhere('review.reviewed_at < :dayEndedAt', { dayEndedAt })
      .getCount();
    return count > 0;
  }
}

export { FlashcardReviewsRepository };
export type { CreateFlashcardReviewData };
