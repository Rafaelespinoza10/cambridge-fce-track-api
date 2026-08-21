import type { DataSource, EntityManager, Repository } from 'typeorm';
import { PracticeAnswer } from '@models/PracticeAnswer';
import type { PracticeAnswerPayload, PracticeAnswerFeedback } from '@models/practice-json-types';
import { isPracticeAnswerPayload } from '@lib/practice/practice-jsonb-validators';

interface CreateAnswerData {
  userId: string;
  exerciseId: string;
  attemptId: string;
  itemId: string;
  answerPayload: PracticeAnswerPayload;
  normalizedAnswer: string | null;
  isCorrect: boolean;
  responseTimeMs: number | null;
  feedback: PracticeAnswerFeedback | null;
}

class PracticeAnswersRepository {
  private readonly answerRepo: Repository<PracticeAnswer>;

  constructor(dataSource: DataSource | EntityManager) {
    this.answerRepo = dataSource.getRepository(PracticeAnswer);
  }

  /**
   * Bound to whatever DataSource/EntityManager was injected at construction
   * time — no transaction opened here. PR 3 (complete attempt + persist
   * answers atomically) is expected to instantiate this repository with a
   * transactional EntityManager from `dataSource.transaction(...)`.
   */
  async createAnswers(answers: CreateAnswerData[]): Promise<PracticeAnswer[]> {
    for (const answer of answers) {
      if (!isPracticeAnswerPayload(answer.answerPayload)) {
        throw new Error(`invalid answerPayload for item ${answer.itemId}`);
      }
    }

    const entities = answers.map((answer) =>
      this.answerRepo.create({
        user_id: answer.userId,
        exercise_id: answer.exerciseId,
        attempt_id: answer.attemptId,
        item_id: answer.itemId,
        answer_payload: answer.answerPayload,
        normalized_answer: answer.normalizedAnswer,
        is_correct: answer.isCorrect,
        response_time_ms: answer.responseTimeMs,
        feedback: answer.feedback,
      }),
    );
    return this.answerRepo.save(entities);
  }

  async findByAttemptForUser(attemptId: string, userId: string): Promise<PracticeAnswer[]> {
    return this.answerRepo
      .createQueryBuilder('answer')
      .where('answer.attempt_id = :attemptId', { attemptId })
      .andWhere('answer.user_id = :userId', { userId })
      .orderBy('answer.created_at', 'ASC')
      .addOrderBy('answer.id', 'ASC')
      .getMany();
  }

  /**
   * At most one row per (attempt_id, item_id) — enforced by
   * uq_practice_answers_attempt_item — so this is a direct lookup, not a
   * "first of many". Used by GeneratePracticeErrorFlashcardDraftService to
   * confirm exactly one persisted answer exists for the item before
   * building AI context from it.
   */
  async findByAttemptAndItemForUser(
    attemptId: string,
    itemId: string,
    userId: string,
  ): Promise<PracticeAnswer | null> {
    return this.answerRepo
      .createQueryBuilder('answer')
      .where('answer.attempt_id = :attemptId', { attemptId })
      .andWhere('answer.item_id = :itemId', { itemId })
      .andWhere('answer.user_id = :userId', { userId })
      .getOne();
  }
}

export { PracticeAnswersRepository };
export type { CreateAnswerData };
