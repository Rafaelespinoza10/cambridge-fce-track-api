import type { DataSource, Repository } from 'typeorm';
import { ActivityScore } from '@models/ActivityScore';
import { ActivityScoreDetail } from '@models/ActivityScoreDetail';
import { PlannedActivity } from '@models/PlannedActivity';
import type { ScoreType, DifficultyLevel, ScoreCriterion } from '@models/enums';

interface CreateScoreData {
  userId: string;
  plannedActivityId: string | null;
  skillId: string | null;
  scoreType: ScoreType;
  correctAnswers: number | null;
  totalQuestions: number | null;
  rawScore: number | null;
  maxScore: number | null;
  percentage: number | null;
  timeSpentMinutes: number | null;
  difficulty: DifficultyLevel | null;
  notes: string | null;
  attemptedAt: Date;
}

interface CreateScoreDetailData {
  activityScoreId: string;
  criterion: ScoreCriterion;
  score: number;
  maxScore: number | null;
  notes: string | null;
}

interface UpdateScoreData {
  correct_answers?: number | null;
  total_questions?: number | null;
  raw_score?: string | null;
  max_score?: string | null;
  percentage?: string | null;
  time_spent_minutes?: number | null;
  difficulty?: DifficultyLevel | null;
  notes?: string | null;
  attempted_at?: Date;
}

interface HistoryQueryOptions {
  userId: string;
  skillId?: string;
  scoreType?: ScoreType;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

interface HistoryExportQueryOptions {
  userId: string;
  skillId?: string;
  scoreType?: ScoreType;
  from?: Date;
  to?: Date;
}

class ScoringRepository {
  private readonly scoreRepo: Repository<ActivityScore>;
  private readonly detailRepo: Repository<ActivityScoreDetail>;
  private readonly plannedActivityRepo: Repository<PlannedActivity>;
  private readonly dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.scoreRepo = dataSource.getRepository(ActivityScore);
    this.detailRepo = dataSource.getRepository(ActivityScoreDetail);
    this.plannedActivityRepo = dataSource.getRepository(PlannedActivity);
  }

  async findPlannedActivityWithOwner(
    plannedActivityId: string,
    userId: string,
  ): Promise<PlannedActivity | null> {
    return this.plannedActivityRepo
      .createQueryBuilder('pa')
      .innerJoinAndSelect('pa.plan_day', 'pd')
      .innerJoinAndSelect('pd.weekly_plan', 'wp')
      .leftJoinAndSelect('pa.skill', 'skill')
      .where('pa.id = :plannedActivityId', { plannedActivityId })
      .andWhere('wp.user_id = :userId', { userId })
      .andWhere('pa.deleted_at IS NULL')
      .andWhere('wp.deleted_at IS NULL')
      .getOne();
  }

  async createScore(data: CreateScoreData): Promise<ActivityScore> {
    const entity = this.scoreRepo.create({
      user_id: data.userId,
      planned_activity_id: data.plannedActivityId,
      skill_id: data.skillId,
      score_type: data.scoreType,
      correct_answers: data.correctAnswers,
      total_questions: data.totalQuestions,
      raw_score: data.rawScore !== null ? String(data.rawScore) : null,
      max_score: data.maxScore !== null ? String(data.maxScore) : null,
      percentage: data.percentage !== null ? String(data.percentage) : null,
      time_spent_minutes: data.timeSpentMinutes,
      difficulty: data.difficulty,
      notes: data.notes,
      attempted_at: data.attemptedAt,
    });
    return this.scoreRepo.save(entity);
  }

  async createScoreDetails(detailsData: CreateScoreDetailData[]): Promise<ActivityScoreDetail[]> {
    const built = detailsData.map((d: CreateScoreDetailData) =>
      this.detailRepo.create({
        activity_score_id: d.activityScoreId,
        criterion: d.criterion,
        score: String(d.score),
        max_score: d.maxScore !== null ? String(d.maxScore) : null,
        notes: d.notes,
      }),
    );
    return this.detailRepo.save(built);
  }

  async findScoreWithDetails(scoreId: string): Promise<ActivityScore | null> {
    return this.scoreRepo
      .createQueryBuilder('score')
      .leftJoinAndSelect('score.score_details', 'sd')
      .leftJoinAndSelect('score.skill', 'skill')
      .where('score.id = :scoreId', { scoreId })
      .andWhere('score.deleted_at IS NULL')
      .getOne();
  }

  async findScoresByPlannedActivity(
    plannedActivityId: string,
    userId: string,
  ): Promise<ActivityScore[]> {
    return this.scoreRepo
      .createQueryBuilder('score')
      .leftJoinAndSelect('score.score_details', 'sd')
      .leftJoinAndSelect('score.skill', 'skill')
      .where('score.planned_activity_id = :plannedActivityId', { plannedActivityId })
      .andWhere('score.user_id = :userId', { userId })
      .andWhere('score.deleted_at IS NULL')
      .orderBy('score.attempted_at', 'DESC')
      .getMany();
  }

  async findScoreHistory(options: HistoryQueryOptions): Promise<[ActivityScore[], number]> {
    const qb = this.scoreRepo
      .createQueryBuilder('score')
      .leftJoinAndSelect('score.score_details', 'sd')
      .leftJoinAndSelect('score.skill', 'skill')
      .where('score.user_id = :userId', { userId: options.userId })
      .andWhere('score.deleted_at IS NULL');

    if (options.skillId !== undefined) {
      qb.andWhere('score.skill_id = :skillId', { skillId: options.skillId });
    }
    if (options.scoreType !== undefined) {
      qb.andWhere('score.score_type = :scoreType', { scoreType: options.scoreType });
    }
    if (options.from !== undefined) {
      qb.andWhere('score.attempted_at >= :from', { from: options.from });
    }
    if (options.to !== undefined) {
      qb.andWhere('score.attempted_at <= :to', { to: options.to });
    }

    qb.orderBy('score.attempted_at', 'DESC').skip(options.offset).take(options.limit);

    return qb.getManyAndCount();
  }

  async findScoreHistoryForExport(options: HistoryExportQueryOptions): Promise<ActivityScore[]> {
    const qb = this.scoreRepo
      .createQueryBuilder('score')
      .leftJoinAndSelect('score.score_details', 'sd')
      .leftJoinAndSelect('score.skill', 'skill')
      .leftJoinAndSelect('score.planned_activity', 'pa')
      .where('score.user_id = :userId', { userId: options.userId })
      .andWhere('score.deleted_at IS NULL');

    if (options.skillId !== undefined) {
      qb.andWhere('score.skill_id = :skillId', { skillId: options.skillId });
    }
    if (options.scoreType !== undefined) {
      qb.andWhere('score.score_type = :scoreType', { scoreType: options.scoreType });
    }
    if (options.from !== undefined) {
      qb.andWhere('score.attempted_at >= :from', { from: options.from });
    }
    if (options.to !== undefined) {
      qb.andWhere('score.attempted_at <= :to', { to: options.to });
    }

    qb.orderBy('score.attempted_at', 'DESC');

    return qb.getMany();
  }

  async updateScore(scoreId: string, data: UpdateScoreData): Promise<void> {
    await this.scoreRepo.update({ id: scoreId }, data);
  }

  async replaceScoreDetails(
    scoreId: string,
    detailsData: CreateScoreDetailData[],
  ): Promise<ActivityScoreDetail[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(ActivityScoreDetail, { activity_score_id: scoreId });
      if (detailsData.length === 0) return [];
      const built = detailsData.map((d) =>
        manager.create(ActivityScoreDetail, {
          activity_score_id: d.activityScoreId,
          criterion: d.criterion,
          score: String(d.score),
          max_score: d.maxScore !== null ? String(d.maxScore) : null,
          notes: d.notes,
        }),
      );
      return manager.save(ActivityScoreDetail, built);
    });
  }

  async softDeleteScore(scoreId: string): Promise<void> {
    await this.scoreRepo.softDelete({ id: scoreId });
  }
}

export { ScoringRepository };
export type {
  CreateScoreData,
  CreateScoreDetailData,
  UpdateScoreData,
  HistoryQueryOptions,
  HistoryExportQueryOptions,
};
