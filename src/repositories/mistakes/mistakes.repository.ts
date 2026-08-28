import type { DataSource, EntityManager, Repository } from 'typeorm';
import { MistakeConcept } from '@models/MistakeConcept';
import type {
  EnglishLevel,
  MistakeClassificationSource,
  MistakeErrorSubtype,
  MistakeErrorType,
  MistakeSource,
  WordClass,
} from '@models/enums';

interface EnsureConceptData {
  userId: string;
  conceptKey: string;
  source: MistakeSource;
  skillSlug: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  taskType: string | null;
  baseWord: string | null;
  prompt: string;
  correctAnswer: string;
  userAnswer: string;
  explanation: string | null;
  targetLevel: EnglishLevel | null;
  occurredAt: Date;
}

interface CreateOccurrenceData {
  userId: string;
  conceptId: string;
  source: MistakeSource;
  practiceAttemptId: string | null;
  practiceExerciseId: string | null;
  practiceItemId: string | null;
  practiceAnswerId: string | null;
  userAnswer: string;
  normalizedAnswer: string | null;
  correctAnswer: string;
  isUnanswered: boolean;
  occurredAt: Date;
}

interface RegisterWrongData {
  conceptId: string;
  userId: string;
  prompt: string;
  correctAnswer: string;
  userAnswer: string;
  explanation: string | null;
  baseWord: string | null;
  taskType: string | null;
  targetLevel: EnglishLevel | null;
  occurredAt: Date;
  /**
   * MistakeClassifier's verdict for THIS occurrence. Written to the row via
   * a conditional UPDATE that never touches a concept whose
   * classification_source is already 'user' — a manual correction always
   * wins over any later deterministic (or AI) reclassification.
   */
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  expectedWordClass: WordClass | null;
  userWordClass: WordClass | null;
  classificationSource: MistakeClassificationSource;
}

interface ListMistakesFilters {
  userId: string;
  skill?: string;
  examCode?: string;
  paperCode?: string;
  partCode?: string;
  errorType?: MistakeErrorType;
  /** Compared case-insensitively against the stored base_word. */
  baseWord?: string;
  page: number;
  pageSize: number;
}

interface ListMistakesResult {
  rows: MistakeConcept[];
  totalItems: number;
}

/**
 * Every method takes `userId` and filters by it — there is no "find by id"
 * that skips ownership, so one user can never reach another user's mistakes
 * through this repository.
 *
 * The writes are raw SQL on purpose: the counters have to move with
 * `ON CONFLICT DO UPDATE` / `times_wrong = times_wrong + 1` inside the
 * submitting transaction, never with a read-modify-write that two concurrent
 * submissions could interleave.
 */
class MistakesRepository {
  private readonly conceptRepo: Repository<MistakeConcept>;

  constructor(private readonly source: DataSource | EntityManager) {
    this.conceptRepo = source.getRepository(MistakeConcept);
  }

  /**
   * Returns the id of this user's concept for `conceptKey`, inserting it if
   * it does not exist yet. Deliberately does NOT touch `times_wrong` — that
   * counter only moves in `registerWrong`, once the occurrence row was
   * really inserted, so a replayed submission can never inflate it.
   */
  async ensureConcept(data: EnsureConceptData): Promise<string> {
    const rows: Array<{ id: string }> = await this.source.query(
      `INSERT INTO mistake_concepts (
         user_id, concept_key, source, skill_slug, exam_code, paper_code, part_code,
         task_type, base_word, prompt, correct_answer, last_user_answer, explanation,
         target_level, times_wrong, times_correct, first_seen_at, last_wrong_at
       ) VALUES (
         $1, $2, $3::mistake_source_enum, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13,
         $14::english_level_enum, 0, 0, $15::timestamptz, $15::timestamptz
       )
       ON CONFLICT (user_id, concept_key) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        data.userId,
        data.conceptKey,
        data.source,
        data.skillSlug,
        data.examCode,
        data.paperCode,
        data.partCode,
        data.taskType,
        data.baseWord,
        data.prompt,
        data.correctAnswer,
        data.userAnswer,
        data.explanation,
        data.targetLevel,
        data.occurredAt,
      ],
    );
    return rows[0].id;
  }

  /**
   * Inserts the occurrence, or returns null when this exact graded answer
   * was already recorded (uq_mistake_occurrences_practice_answer). That null
   * is what tells the caller to skip the counter update.
   */
  async createOccurrence(data: CreateOccurrenceData): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.source.query(
      `INSERT INTO mistake_occurrences (
         user_id, concept_id, source, practice_attempt_id, practice_exercise_id,
         practice_item_id, practice_answer_id, user_answer, normalized_answer,
         correct_answer, is_unanswered, occurred_at
       ) VALUES (
         $1, $2, $3::mistake_source_enum, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12
       )
       ON CONFLICT (practice_answer_id) WHERE practice_answer_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        data.userId,
        data.conceptId,
        data.source,
        data.practiceAttemptId,
        data.practiceExerciseId,
        data.practiceItemId,
        data.practiceAnswerId,
        data.userAnswer,
        data.normalizedAnswer,
        data.correctAnswer,
        data.isUnanswered,
        data.occurredAt,
      ],
    );
    return rows.length === 0 ? null : rows[0].id;
  }

  /**
   * Bumps the failure counter and refreshes the snapshot the Mistakes list
   * renders from. `GREATEST` keeps `last_wrong_at` monotonic even if an
   * older submission is recorded after a newer one; `COALESCE` never
   * overwrites a known explanation/base word with a null coming from an item
   * that happens to lack one.
   */
  /**
   * The four classification columns only ever move via the `CASE WHEN
   * classification_source = 'user' THEN <current> ELSE <new>` guard below —
   * a manual correction (classification_source='user') is permanent until a
   * human changes it again; MistakeClassifier re-running on a later wrong
   * answer for the same concept can never silently overwrite it.
   */
  async registerWrong(data: RegisterWrongData): Promise<void> {
    await this.source.query(
      `UPDATE mistake_concepts SET
         times_wrong = times_wrong + 1,
         last_wrong_at = GREATEST(last_wrong_at, $3::timestamptz),
         prompt = $4,
         correct_answer = $5,
         last_user_answer = $6,
         explanation = COALESCE($7, explanation),
         base_word = COALESCE($8, base_word),
         task_type = COALESCE($9, task_type),
         target_level = COALESCE($10::english_level_enum, target_level),
         error_type = CASE WHEN classification_source = 'user' THEN error_type ELSE $11::mistake_error_type_enum END,
         error_subtype = CASE WHEN classification_source = 'user' THEN error_subtype ELSE $12::mistake_error_subtype_enum END,
         expected_word_class = CASE WHEN classification_source = 'user' THEN expected_word_class ELSE $13::word_class_enum END,
         user_word_class = CASE WHEN classification_source = 'user' THEN user_word_class ELSE $14::word_class_enum END,
         classification_source = CASE WHEN classification_source = 'user' THEN classification_source ELSE $15::mistake_classification_source_enum END,
         updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        data.conceptId,
        data.userId,
        data.occurredAt,
        data.prompt,
        data.correctAnswer,
        data.userAnswer,
        data.explanation,
        data.baseWord,
        data.taskType,
        data.targetLevel,
        data.errorType,
        data.errorSubtype,
        data.expectedWordClass,
        data.userWordClass,
        data.classificationSource,
      ],
    );
  }

  /**
   * A later correct answer on a concept the user had already failed. Only
   * ever UPDATEs: a correct answer must never create a mistake, so when the
   * concept does not exist this is a no-op and returns false.
   */
  async registerLaterCorrect(userId: string, conceptKey: string, at: Date): Promise<boolean> {
    // node-postgres returns [rows, affectedCount] for an UPDATE issued
    // through TypeORM's raw query().
    const result: [unknown[], number] = await this.source.query(
      `UPDATE mistake_concepts SET
         times_correct = times_correct + 1,
         last_correct_at = GREATEST(COALESCE(last_correct_at, $3::timestamptz), $3::timestamptz),
         updated_at = now()
       WHERE user_id = $1 AND concept_key = $2`,
      [userId, conceptKey, at],
    );
    return Array.isArray(result) && typeof result[1] === 'number' && result[1] > 0;
  }

  /**
   * Ownership-scoped lookup for "Practice this mistake" — every id not
   * belonging to `userId` (typo'd, deleted, or someone else's) is silently
   * absent from the result rather than erroring, so the caller can report
   * "no eligible mistakes" uniformly instead of distinguishing "not found"
   * from "not yours".
   */
  async findByIdsForUser(userId: string, ids: string[]): Promise<MistakeConcept[]> {
    if (ids.length === 0) return [];
    return this.conceptRepo
      .createQueryBuilder('concept')
      .where('concept.user_id = :userId', { userId })
      .andWhere('concept.id IN (:...ids)', { ids })
      .getMany();
  }

  /**
   * Candidate pool for "Practice my weaknesses" — most-failed first, most
   * recently failed as tie-break. Selection/diversity/slot-planning happens
   * in @lib/mistakes/select-mistake-weaknesses.ts, never here.
   */
  async findTopWeaknessesForUser(userId: string, limit: number): Promise<MistakeConcept[]> {
    return this.conceptRepo
      .createQueryBuilder('concept')
      .where('concept.user_id = :userId', { userId })
      .orderBy('concept.times_wrong', 'DESC')
      .addOrderBy('concept.last_wrong_at', 'DESC')
      .addOrderBy('concept.id', 'ASC')
      .take(limit)
      .getMany();
  }

  /** Most recently failed first. Always scoped to `filters.userId`. */
  async listByUser(filters: ListMistakesFilters): Promise<ListMistakesResult> {
    const query = this.conceptRepo
      .createQueryBuilder('concept')
      .where('concept.user_id = :userId', { userId: filters.userId });

    if (filters.skill !== undefined) {
      query.andWhere('concept.skill_slug = :skill', { skill: filters.skill });
    }
    if (filters.examCode !== undefined) {
      query.andWhere('concept.exam_code = :examCode', { examCode: filters.examCode });
    }
    if (filters.paperCode !== undefined) {
      query.andWhere('concept.paper_code = :paperCode', { paperCode: filters.paperCode });
    }
    if (filters.partCode !== undefined) {
      query.andWhere('concept.part_code = :partCode', { partCode: filters.partCode });
    }
    if (filters.errorType !== undefined) {
      query.andWhere('concept.error_type = :errorType', { errorType: filters.errorType });
    }
    if (filters.baseWord !== undefined) {
      query.andWhere('LOWER(concept.base_word) = :baseWord', {
        baseWord: filters.baseWord.toLowerCase(),
      });
    }

    const [rows, totalItems] = await query
      .orderBy('concept.last_wrong_at', 'DESC')
      .addOrderBy('concept.id', 'ASC')
      .skip((filters.page - 1) * filters.pageSize)
      .take(filters.pageSize)
      .getManyAndCount();

    return { rows, totalItems };
  }
}

export { MistakesRepository };
export type {
  EnsureConceptData,
  CreateOccurrenceData,
  RegisterWrongData,
  ListMistakesFilters,
  ListMistakesResult,
};
