import type { DataSource, EntityManager, Repository } from 'typeorm';
import { MockAttempt } from '@models/MockAttempt';
import { MockAttemptSection } from '@models/MockAttemptSection';
import { MockAttemptStatus, MockAttemptSectionStatus, ExamType } from '@models/enums';
import type { MockAttemptSectionContentType } from '@models/enums';
import type {
  MockAttemptSectionAnswers,
  MockAttemptSectionGradingFeedback,
} from '@models/mock-attempt-json-types';
import { MOCK_ATTEMPT_SECTION_CATALOG } from '@lib/mocks/mock-attempt-catalog';

type RepositorySource = DataSource | EntityManager;

export interface CreateAttemptSectionSeed {
  sectionCode: string;
  contentType: MockAttemptSectionContentType;
  timeLimitSeconds: number;
}

export interface CreateAttemptData {
  userId: string;
  examType: ExamType;
  startedAt: Date;
  sections: CreateAttemptSectionSeed[];
}

export interface StartSectionContentData {
  practiceExerciseId?: string | null;
  writingTaskId?: string | null;
  listeningSourceId?: string | null;
  startedAt: Date;
  /** UoE-only time-banking override — see StartMockAttemptSectionService.computeUseOfEnglishTimeLimitSeconds. */
  timeLimitSecondsOverride?: number;
}

export interface CompleteSectionData {
  answers: MockAttemptSectionAnswers;
  rawScore: number;
  maxScore: number;
  gradingFeedback: MockAttemptSectionGradingFeedback;
  completedAt: Date;
}

class MockAttemptsRepository {
  private readonly attemptRepo: Repository<MockAttempt>;
  private readonly sectionRepo: Repository<MockAttemptSection>;

  constructor(source: RepositorySource) {
    this.attemptRepo = source.getRepository(MockAttempt);
    this.sectionRepo = source.getRepository(MockAttemptSection);
  }

  async createAttemptWithSections(data: CreateAttemptData): Promise<MockAttempt> {
    const attempt = await this.attemptRepo.save(
      this.attemptRepo.create({
        user_id: data.userId,
        exam_type: data.examType,
        status: MockAttemptStatus.IN_PROGRESS,
        started_at: data.startedAt,
      }),
    );

    const sections = data.sections.map((s) =>
      this.sectionRepo.create({
        mock_attempt_id: attempt.id,
        section_code: s.sectionCode,
        content_type: s.contentType,
        status: MockAttemptSectionStatus.PENDING,
        time_limit_seconds: s.timeLimitSeconds,
        answers: [],
      }),
    );
    await this.sectionRepo.save(sections);

    return attempt;
  }

  async findActiveByUser(userId: string): Promise<MockAttempt | null> {
    return this.attemptRepo
      .createQueryBuilder('attempt')
      .where('attempt.user_id = :userId', { userId })
      .andWhere('attempt.status = :status', { status: MockAttemptStatus.IN_PROGRESS })
      .getOne();
  }

  async findByIdForUser(attemptId: string, userId: string): Promise<MockAttempt | null> {
    return this.attemptRepo
      .createQueryBuilder('attempt')
      .where('attempt.id = :attemptId', { attemptId })
      .andWhere('attempt.user_id = :userId', { userId })
      .getOne();
  }

  /**
   * Ordered by real exam progression (MOCK_ATTEMPT_SECTION_CATALOG's own
   * order — UoE 1-4, Reading 5-7, Writing 1-2, Listening 1-4), never by
   * `section_code` alphabetically ('listening-part-1' would otherwise sort
   * before 'uoe-part-1'). The frontend relies on this array order both to
   * label "Part X of 13" and to derive which section the student is on
   * (the first non-'completed' entry), so a wrong order here silently
   * reshuffles the whole exam sequence.
   */
  async findSectionsByAttempt(attemptId: string): Promise<MockAttemptSection[]> {
    const sections = await this.sectionRepo.find({ where: { mock_attempt_id: attemptId } });
    const orderIndex = new Map(
      MOCK_ATTEMPT_SECTION_CATALOG.map((entry, index) => [entry.sectionCode, index]),
    );
    return [...sections].sort(
      (a, b) =>
        (orderIndex.get(a.section_code) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(b.section_code) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  /** Scoped through the parent attempt's owner — never trusts a bare sectionId/attemptId pair without also checking userId. */
  async findSectionByCodeForUser(
    attemptId: string,
    sectionCode: string,
    userId: string,
  ): Promise<MockAttemptSection | null> {
    return this.sectionRepo
      .createQueryBuilder('section')
      .innerJoin(MockAttempt, 'attempt', 'attempt.id = section.mock_attempt_id')
      .where('section.mock_attempt_id = :attemptId', { attemptId })
      .andWhere('section.section_code = :sectionCode', { sectionCode })
      .andWhere('attempt.user_id = :userId', { userId })
      .getOne();
  }

  async startSectionContent(sectionId: string, data: StartSectionContentData): Promise<void> {
    await this.sectionRepo.update(
      { id: sectionId },
      {
        practice_exercise_id: data.practiceExerciseId ?? null,
        writing_task_id: data.writingTaskId ?? null,
        listening_source_id: data.listeningSourceId ?? null,
        status: MockAttemptSectionStatus.IN_PROGRESS,
        started_at: data.startedAt,
        ...(data.timeLimitSecondsOverride !== undefined
          ? { time_limit_seconds: data.timeLimitSecondsOverride }
          : {}),
      },
    );
  }

  async saveSectionDraftAnswers(
    sectionId: string,
    answers: MockAttemptSectionAnswers,
  ): Promise<void> {
    await this.sectionRepo.update({ id: sectionId }, { answers });
  }

  async completeSection(sectionId: string, data: CompleteSectionData): Promise<void> {
    await this.sectionRepo.update(
      { id: sectionId },
      {
        answers: data.answers,
        raw_score: String(data.rawScore),
        max_score: String(data.maxScore),
        grading_feedback: data.gradingFeedback,
        status: MockAttemptSectionStatus.COMPLETED,
        completed_at: data.completedAt,
      },
    );
  }

  async completeAttempt(
    attemptId: string,
    data: { submittedAt: Date; resultMockTestId: string },
  ): Promise<void> {
    await this.attemptRepo.update(
      { id: attemptId },
      {
        status: MockAttemptStatus.COMPLETED,
        submitted_at: data.submittedAt,
        result_mock_test_id: data.resultMockTestId,
      },
    );
  }

  async abandonAttempt(attemptId: string): Promise<void> {
    await this.attemptRepo.update({ id: attemptId }, { status: MockAttemptStatus.ABANDONED });
  }
}

export { MockAttemptsRepository };
