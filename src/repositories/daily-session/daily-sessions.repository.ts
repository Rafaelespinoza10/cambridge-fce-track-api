import type { DataSource, EntityManager, Repository } from 'typeorm';
import { DailySession } from '@models/DailySession';
import { DailySessionItem } from '@models/DailySessionItem';
import { DailySessionSubmission } from '@models/DailySessionSubmission';
import type { DailySessionSource, DailySessionSubmissionStatus, EnglishLevel } from '@models/enums';
import type {
  DailySessionItemOption,
  DailySessionItemAnswerKey,
  DailySessionSentenceTarget,
  DailySessionSentenceFeedback,
  DailySessionGenerationMetadata,
} from '@models/daily-session-json-types';
import {
  isDailySessionItemAnswerKey,
  isDailySessionItemOptionArray,
  isDailySessionSentenceTargetArray,
  isSafeGenerationMetadata,
} from '@lib/daily-session/daily-session-jsonb-validators';
import type {
  DailySessionSafeDto,
  DailySessionItemSafeDto,
  DailySessionSafeWithItems,
} from '../../interfaces/daily-session/daily-session.interface';

interface CreateSessionData {
  userId: string;
  sessionDate: string;
  timezone: string;
  targetLevel: EnglishLevel | null;
  topic: string;
  readingTitle: string;
  readingInstructions: string;
  readingPassage: string;
  itemCount: number;
  sentenceTaskInstructions: string;
  sentenceTargets: DailySessionSentenceTarget[];
  source: DailySessionSource;
  model: string | null;
  promptVersion: string | null;
  generationMetadata: DailySessionGenerationMetadata | null;
}

interface CreateItemData {
  position: number;
  prompt: string;
  options: DailySessionItemOption[] | null;
  answerKey: DailySessionItemAnswerKey;
  explanation: string | null;
  skillTags: string[];
}

/** Internal-only: includes answerKey/explanation, fetched via an explicit addSelect(). */
interface DailySessionWithAnswerKeysForEvaluation {
  session: DailySession;
  items: DailySessionItem[];
}

interface ListDailySessionHistoryFilters {
  userId: string;
  page: number;
  pageSize: number;
}

/** Raw projection straight out of Postgres — numerics arrive as strings, normalized by the service. */
interface DailySessionHistorySessionRawRow {
  sessionId: string;
  sessionDate: string;
  topic: string;
  readingTitle: string;
  targetLevel: EnglishLevel | null;
  itemCount: number;
  createdAt: Date;
}

interface DailySessionHistorySubmissionRawRow {
  submissionId: string;
  dailySessionId: string;
  status: DailySessionSubmissionStatus;
  startedAt: Date;
  submittedAt: Date | null;
  durationSeconds: number | null;
  comprehensionCorrectCount: number | null;
  comprehensionTotalCount: number | null;
  /** numeric(5,2) — a string, or null while still in progress. */
  comprehensionPercentage: string | null;
  sentenceFeedback: DailySessionSentenceFeedback | null;
}

interface DailySessionHistoryRow extends DailySessionHistorySessionRawRow {
  submission: DailySessionHistorySubmissionRawRow | null;
}

interface ListDailySessionHistoryResult {
  rows: DailySessionHistoryRow[];
  totalItems: number;
}

function toSafeSessionDto(session: DailySession): DailySessionSafeDto {
  return {
    id: session.id,
    sessionDate: session.session_date,
    targetLevel: session.target_level,
    topic: session.topic,
    readingTitle: session.reading_title,
    readingInstructions: session.reading_instructions,
    readingPassage: session.reading_passage,
    itemCount: session.item_count,
    sentenceTaskInstructions: session.sentence_task_instructions,
    sentenceTargets: session.sentence_targets,
    createdAt: session.created_at,
  };
}

function toSafeItemDto(item: DailySessionItem): DailySessionItemSafeDto {
  return {
    id: item.id,
    position: item.position,
    prompt: item.prompt,
    options: item.options,
    skillTags: item.skill_tags,
  };
}

class DailySessionsRepository {
  private readonly sessionRepo: Repository<DailySession>;
  private readonly itemRepo: Repository<DailySessionItem>;
  private readonly submissionRepo: Repository<DailySessionSubmission>;

  constructor(dataSource: DataSource | EntityManager) {
    this.sessionRepo = dataSource.getRepository(DailySession);
    this.itemRepo = dataSource.getRepository(DailySessionItem);
    // Read-only here, and only for the history list's submission summary —
    // every write to a submission goes through DailySessionSubmissionsRepository.
    this.submissionRepo = dataSource.getRepository(DailySessionSubmission);
  }

  async createSession(data: CreateSessionData): Promise<DailySession> {
    if (!isSafeGenerationMetadata(data.generationMetadata)) {
      throw new Error('generationMetadata contains a forbidden key (secret, prompt or headers)');
    }
    if (!isDailySessionSentenceTargetArray(data.sentenceTargets)) {
      throw new Error('invalid sentenceTargets');
    }

    const session = this.sessionRepo.create({
      user_id: data.userId,
      session_date: data.sessionDate,
      timezone: data.timezone,
      target_level: data.targetLevel,
      topic: data.topic,
      reading_title: data.readingTitle,
      reading_instructions: data.readingInstructions,
      reading_passage: data.readingPassage,
      item_count: data.itemCount,
      sentence_task_instructions: data.sentenceTaskInstructions,
      sentence_targets: data.sentenceTargets,
      source: data.source,
      model: data.model,
      prompt_version: data.promptVersion,
      generation_metadata: data.generationMetadata,
    });
    return this.sessionRepo.save(session);
  }

  async createItems(sessionId: string, items: CreateItemData[]): Promise<DailySessionItem[]> {
    for (const item of items) {
      if (!isDailySessionItemAnswerKey(item.answerKey)) {
        throw new Error(`invalid answerKey for item at position ${item.position}`);
      }
      if (item.options !== null && !isDailySessionItemOptionArray(item.options)) {
        throw new Error(`invalid options for item at position ${item.position}`);
      }
    }

    const entities = items.map((item) =>
      this.itemRepo.create({
        daily_session_id: sessionId,
        position: item.position,
        prompt: item.prompt,
        options: item.options,
        answer_key: item.answerKey,
        explanation: item.explanation,
        skill_tags: item.skillTags,
      }),
    );
    return this.itemRepo.save(entities);
  }

  async findByIdForUser(sessionId: string, userId: string): Promise<DailySession | null> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .where('session.id = :sessionId', { sessionId })
      .andWhere('session.user_id = :userId', { userId })
      .andWhere('session.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Ignores soft-deleted rows — matches uq_daily_sessions_user_session_date
   * (partial, WHERE deleted_at IS NULL), so a soft-deleted session never
   * blocks generating a brand new one for the same calendar day. This is the
   * idempotency pre-check GenerateDailySessionService runs before ever
   * calling the LLM.
   */
  async findByUserAndSessionDate(
    userId: string,
    sessionDate: string,
  ): Promise<DailySession | null> {
    return this.sessionRepo
      .createQueryBuilder('session')
      .where('session.user_id = :userId', { userId })
      .andWhere('session.session_date = :sessionDate', { sessionDate })
      .andWhere('session.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Client-facing projection: never selects answer_key/explanation (they
   * carry `select: false` at the column level, so a plain `find()` already
   * excludes them — this method never needs to override that), and the
   * hand-built DTO mapping is a second, independent layer that also can't
   * leak them, generationMetadata, user_id or deleted_at.
   */
  async findSafeSessionForUser(
    sessionId: string,
    userId: string,
  ): Promise<DailySessionSafeWithItems | null> {
    const session = await this.findByIdForUser(sessionId, userId);
    if (session === null) return null;

    const items = await this.itemRepo.find({
      where: { daily_session_id: sessionId },
      order: { position: 'ASC' },
    });

    return {
      session: toSafeSessionDto(session),
      items: items.map(toSafeItemDto),
    };
  }

  /**
   * Paginated history of a user's sessions, newest calendar day first, each
   * paired with a summary of its most recent submission.
   *
   * Done as TWO simple queries rather than one join, on purpose. There is no
   * uniqueness constraint on daily_session_submissions.daily_session_id (a
   * session can be started, abandoned, then started again), so "the session's
   * submission" is really "the latest of N" — which in one statement needs
   * DISTINCT ON or a window function. Since nothing here FILTERS on submission
   * columns, the page of sessions can be selected on its own and the
   * submissions fetched for just those ids (pageSize is capped at 50 by the
   * service), picking the newest per session in code. Contrast
   * PracticeAttemptsRepository.listHistoryByUser, which does need its join
   * because it filters on exercise columns.
   *
   * Both queries use a hand-selected raw projection: reading_passage is large
   * and a history list never renders it, and generation_metadata/user_id/
   * deleted_at stay out of reach entirely.
   */
  async listHistoryByUser(
    filters: ListDailySessionHistoryFilters,
  ): Promise<ListDailySessionHistoryResult> {
    const qb = this.sessionRepo
      .createQueryBuilder('session')
      .where('session.user_id = :userId', { userId: filters.userId })
      .andWhere('session.deleted_at IS NULL');

    // getCount() clones the builder before overriding SELECT, so `qb` is
    // untouched and safe to keep building on — same as the Practice history.
    const totalItems = await qb.getCount();
    if (totalItems === 0) return { rows: [], totalItems: 0 };

    const sessionRows = await qb
      .select('session.id', 'sessionId')
      .addSelect('session.session_date', 'sessionDate')
      .addSelect('session.topic', 'topic')
      .addSelect('session.reading_title', 'readingTitle')
      .addSelect('session.target_level', 'targetLevel')
      .addSelect('session.item_count', 'itemCount')
      .addSelect('session.created_at', 'createdAt')
      .orderBy('session.session_date', 'DESC')
      .addOrderBy('session.id', 'ASC')
      .offset((filters.page - 1) * filters.pageSize)
      .limit(filters.pageSize)
      .getRawMany<DailySessionHistorySessionRawRow>();

    if (sessionRows.length === 0) return { rows: [], totalItems };

    const latestBySessionId = await this.findLatestSubmissionsBySessionIds(
      sessionRows.map((row) => row.sessionId),
    );

    return {
      rows: sessionRows.map((row) => ({
        ...row,
        submission: latestBySessionId.get(row.sessionId) ?? null,
      })),
      totalItems,
    };
  }

  /**
   * Newest submission per session id. Ordered started_at DESC so the first
   * row seen for a session id is its latest; `id` breaks ties so two
   * submissions sharing a started_at still resolve deterministically.
   */
  private async findLatestSubmissionsBySessionIds(
    sessionIds: string[],
  ): Promise<Map<string, DailySessionHistorySubmissionRawRow>> {
    const rows = await this.submissionRepo
      .createQueryBuilder('sub')
      .select('sub.id', 'submissionId')
      .addSelect('sub.daily_session_id', 'dailySessionId')
      .addSelect('sub.status', 'status')
      .addSelect('sub.started_at', 'startedAt')
      .addSelect('sub.submitted_at', 'submittedAt')
      .addSelect('sub.duration_seconds', 'durationSeconds')
      .addSelect('sub.comprehension_correct_count', 'comprehensionCorrectCount')
      .addSelect('sub.comprehension_total_count', 'comprehensionTotalCount')
      .addSelect('sub.comprehension_percentage', 'comprehensionPercentage')
      .addSelect('sub.sentence_feedback', 'sentenceFeedback')
      .where('sub.daily_session_id IN (:...sessionIds)', { sessionIds })
      .andWhere('sub.deleted_at IS NULL')
      .orderBy('sub.started_at', 'DESC')
      .addOrderBy('sub.id', 'ASC')
      .getRawMany<DailySessionHistorySubmissionRawRow>();

    const latest = new Map<string, DailySessionHistorySubmissionRawRow>();
    for (const row of rows) {
      if (!latest.has(row.dailySessionId)) latest.set(row.dailySessionId, row);
    }
    return latest;
  }

  /**
   * Internal-only: explicitly opts back into answer_key/explanation via
   * addSelect(). Only for the grading path — never expose this result to a
   * client response.
   */
  async findSessionWithAnswerKeysForEvaluation(
    sessionId: string,
    userId: string,
  ): Promise<DailySessionWithAnswerKeysForEvaluation | null> {
    const session = await this.findByIdForUser(sessionId, userId);
    if (session === null) return null;

    const items = await this.itemRepo
      .createQueryBuilder('item')
      .addSelect('item.answer_key')
      .addSelect('item.explanation')
      .where('item.daily_session_id = :sessionId', { sessionId })
      .orderBy('item.position', 'ASC')
      .getMany();

    return { session, items };
  }
}

export { DailySessionsRepository };
export type { CreateSessionData, CreateItemData, DailySessionWithAnswerKeysForEvaluation };
export type {
  ListDailySessionHistoryFilters,
  ListDailySessionHistoryResult,
  DailySessionHistoryRow,
  DailySessionHistorySessionRawRow,
  DailySessionHistorySubmissionRawRow,
};
export type {
  DailySessionSafeDto,
  DailySessionItemSafeDto,
  DailySessionSafeWithItems,
} from '../../interfaces/daily-session/daily-session.interface';
