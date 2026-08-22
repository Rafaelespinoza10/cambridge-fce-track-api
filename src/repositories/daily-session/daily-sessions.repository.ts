import type { DataSource, EntityManager, Repository } from 'typeorm';
import { DailySession } from '@models/DailySession';
import { DailySessionItem } from '@models/DailySessionItem';
import type { DailySessionSource, EnglishLevel } from '@models/enums';
import type {
  DailySessionItemOption,
  DailySessionItemAnswerKey,
  DailySessionSentenceTarget,
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

  constructor(dataSource: DataSource | EntityManager) {
    this.sessionRepo = dataSource.getRepository(DailySession);
    this.itemRepo = dataSource.getRepository(DailySessionItem);
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
  DailySessionSafeDto,
  DailySessionItemSafeDto,
  DailySessionSafeWithItems,
} from '../../interfaces/daily-session/daily-session.interface';
