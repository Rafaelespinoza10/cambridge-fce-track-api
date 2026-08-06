import type { DataSource, EntityManager, Repository } from 'typeorm';
import { PracticeAnswer } from '../models/PracticeAnswer';
import type { PracticeAnswerPayload, PracticeAnswerFeedback } from '../models/practice-json-types';
import { isPracticeAnswerPayload } from '../lib/practice-jsonb-validators';

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
}

export { PracticeAnswersRepository };
export type { CreateAnswerData };
