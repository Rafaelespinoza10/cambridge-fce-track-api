import type { DataSource, EntityManager, Repository } from 'typeorm';
import { WeaknessReview } from '@models/WeaknessReview';
import {
  WeaknessReviewStatus,
  WeaknessReviewResult,
  type MistakeErrorType,
  type MistakeErrorSubtype,
} from '@models/enums';

/** Pattern identity — the same six fields MistakeConcept carries. */
export interface ReviewPatternIdentity {
  skillSlug: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
}

export interface ScheduleReviewData extends ReviewPatternIdentity {
  userId: string;
  dueAt: Date;
  intervalDays: number;
  consecutiveSuccessfulReviews: number;
  masteryScoreBefore: number;
}

export interface CompleteReviewData {
  reviewId: string;
  userId: string;
  completedAt: Date;
  result: WeaknessReviewResult;
  correctCount: number;
  totalCount: number;
  distinctCorrectFamilies: number;
  masteryScoreAfter: number;
  practiceExerciseId: string | null;
  practiceAttemptId: string | null;
}

/**
 * Every method takes `userId` and filters by it — including the lookups by
 * id, so "not yours" and "does not exist" are indistinguishable to a caller
 * and a user can never read, generate from, or complete another user's
 * review.
 */
class WeaknessReviewsRepository {
  private readonly reviewRepo: Repository<WeaknessReview>;

  constructor(private readonly source: DataSource | EntityManager) {
    this.reviewRepo = source.getRepository(WeaknessReview);
  }

  /**
   * Creates the pattern's scheduled review, or moves the existing one — but
   * only ever CLOSER (`LEAST`). That asymmetry is the anti-postponement
   * rule: practising a weakness voluntarily can pull its check-up forward
   * when mastery drops, and can never push a retest away. The ladder rung
   * itself is left alone; only a real retest moves it.
   *
   * Relies on the two partial unique indexes, so two concurrent submissions
   * cannot both insert a scheduled row for the same pattern.
   */
  async upsertScheduled(data: ScheduleReviewData): Promise<void> {
    // The active-review guard is two partial unique indexes (the migration
    // explains why it cannot be one COALESCE expression index), so the
    // arbiter this INSERT names must be the one that actually applies.
    const conflictTarget =
      data.errorSubtype === null
        ? "(user_id, part_code, error_type) WHERE status = 'scheduled' AND error_subtype IS NULL"
        : '(user_id, part_code, error_type, error_subtype) ' +
          "WHERE status = 'scheduled' AND error_subtype IS NOT NULL";

    await this.source.query(
      `INSERT INTO weakness_reviews (
         user_id, skill_slug, exam_code, paper_code, part_code, error_type, error_subtype,
         status, due_at, interval_days, consecutive_successful_reviews, mastery_score_before
       ) VALUES (
         $1, $2, $3, $4, $5, $6::mistake_error_type_enum, $7::mistake_error_subtype_enum,
         'scheduled', $8::timestamptz, $9, $10, $11
       )
       ON CONFLICT ${conflictTarget}
       DO UPDATE SET
         due_at = LEAST(weakness_reviews.due_at, EXCLUDED.due_at),
         mastery_score_before = EXCLUDED.mastery_score_before,
         updated_at = now()`,
      [
        data.userId,
        data.skillSlug,
        data.examCode,
        data.paperCode,
        data.partCode,
        data.errorType,
        data.errorSubtype,
        data.dueAt,
        data.intervalDays,
        data.consecutiveSuccessfulReviews,
        data.masteryScoreBefore,
      ],
    );
  }

  /** The user's own scheduled reviews, soonest first. */
  async findScheduledForUser(userId: string): Promise<WeaknessReview[]> {
    return this.reviewRepo
      .createQueryBuilder('review')
      .where('review.user_id = :userId', { userId })
      .andWhere('review.status = :status', { status: WeaknessReviewStatus.SCHEDULED })
      .orderBy('review.due_at', 'ASC')
      .addOrderBy('review.id', 'ASC')
      .getMany();
  }

  /**
   * Scheduled reviews by id, ownership-checked. Ids that are not this user's
   * (or do not exist) are simply absent from the result, so the caller
   * reports one uniform "no eligible reviews" instead of leaking which.
   */
  async findScheduledByIdsForUser(userId: string, ids: string[]): Promise<WeaknessReview[]> {
    if (ids.length === 0) return [];
    return this.reviewRepo
      .createQueryBuilder('review')
      .where('review.user_id = :userId', { userId })
      .andWhere('review.id IN (:...ids)', { ids })
      .andWhere('review.status = :status', { status: WeaknessReviewStatus.SCHEDULED })
      .orderBy('review.due_at', 'ASC')
      .getMany();
  }

  async findByIdForUser(userId: string, id: string): Promise<WeaknessReview | null> {
    return this.reviewRepo
      .createQueryBuilder('review')
      .where('review.user_id = :userId', { userId })
      .andWhere('review.id = :id', { id })
      .getOne();
  }

  /**
   * Closes a review. The `status = 'scheduled'` guard makes this idempotent
   * under a replayed submission: the second call updates zero rows and
   * returns false, so a completed review can never be completed twice (and
   * can never schedule a second follow-up).
   */
  async complete(data: CompleteReviewData): Promise<boolean> {
    const result: [unknown[], number] = await this.source.query(
      `UPDATE weakness_reviews SET
         status = 'completed',
         completed_at = $3::timestamptz,
         result = $4::weakness_review_result_enum,
         correct_count = $5,
         total_count = $6,
         distinct_correct_families = $7,
         mastery_score_after = $8,
         practice_exercise_id = $9,
         practice_attempt_id = $10,
         updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'scheduled'`,
      [
        data.reviewId,
        data.userId,
        data.completedAt,
        data.result,
        data.correctCount,
        data.totalCount,
        data.distinctCorrectFamilies,
        data.masteryScoreAfter,
        data.practiceExerciseId,
        data.practiceAttemptId,
      ],
    );
    return Array.isArray(result) && typeof result[1] === 'number' && result[1] > 0;
  }

  /**
   * Retires the scheduled review of a pattern that stopped being eligible —
   * kept as history rather than deleted, so "this was scheduled and then the
   * pattern regressed" stays visible.
   */
  async cancelScheduled(userId: string, identity: ReviewPatternIdentity): Promise<void> {
    await this.source.query(
      `UPDATE weakness_reviews SET status = 'cancelled', updated_at = now()
        WHERE user_id = $1 AND part_code = $2
          AND error_type = $3::mistake_error_type_enum
          AND COALESCE(error_subtype::text, 'none') = COALESCE($4::text, 'none')
          AND status = 'scheduled'`,
      [userId, identity.partCode, identity.errorType, identity.errorSubtype],
    );
  }
}

export { WeaknessReviewsRepository };
