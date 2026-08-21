import type { DataSource } from 'typeorm';
import { PracticeAttempt } from '@models/PracticeAttempt';
import { PracticeExercise } from '@models/PracticeExercise';
import { PracticeAnswer } from '@models/PracticeAnswer';
import { PracticeItem } from '@models/PracticeItem';
import { PracticeAttemptStatus } from '@models/enums';
import type { PracticeInsightRow } from '@lib/practice/practice-insights-calculator';
export class PracticeInsightsRepository {
  constructor(private readonly dataSource: DataSource) {}
  async listRows(userId: string, since: Date): Promise<PracticeInsightRow[]> {
    const raw = await this.dataSource
      .getRepository(PracticeAttempt)
      .createQueryBuilder('a')
      .innerJoin(PracticeExercise, 'e', 'e.id = a.exercise_id AND e.deleted_at IS NULL')
      .innerJoin(
        PracticeAnswer,
        'answer',
        'answer.attempt_id = a.id AND answer.user_id = a.user_id',
      )
      .innerJoin(PracticeItem, 'item', 'item.id = answer.item_id AND item.exercise_id = e.id')
      .select('a.id', 'attemptId')
      .addSelect('a.submitted_at', 'submittedAt')
      .addSelect('a.duration_seconds', 'durationSeconds')
      .addSelect('e.exam_code', 'examCode')
      .addSelect('e.paper_code', 'paperCode')
      .addSelect('e.part_code', 'partCode')
      .addSelect('item.skill_tags', 'skillTags')
      .addSelect('answer.is_correct', 'isCorrect')
      .addSelect("answer.answer_payload->>'kind'", 'answerKind')
      .where('a.user_id = :userId', { userId })
      .andWhere('a.status = :status', { status: PracticeAttemptStatus.COMPLETED })
      .andWhere('a.deleted_at IS NULL')
      .andWhere('a.submitted_at >= :since', { since })
      .orderBy('a.submitted_at', 'DESC')
      .addOrderBy('a.id', 'ASC')
      .getRawMany();
    return raw.map((r: any) => ({
      attemptId: r.attemptId,
      submittedAt: new Date(r.submittedAt),
      durationSeconds: r.durationSeconds === null ? null : Number(r.durationSeconds),
      examCode: r.examCode,
      paperCode: r.paperCode,
      partCode: r.partCode,
      skillTags: Array.isArray(r.skillTags) ? r.skillTags : [],
      isCorrect: r.isCorrect === true || r.isCorrect === 'true',
      isUnanswered: r.answerKind === 'unanswered',
    }));
  }
}
