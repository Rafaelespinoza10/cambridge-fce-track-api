import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { Flashcard } from '../models/Flashcard';
import { FlashcardStatus } from '../models/enums';
import type { FlashcardType, EnglishLevel } from '../models/enums';

interface CreateFlashcardData {
  userId: string;
  deckId: string;
  type: FlashcardType;
  front: string;
  back: string;
  translation: string | null;
  example: string | null;
  personalExample: string | null;
  notes: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  level: EnglishLevel | null;
  tags: string[];
}

interface UpdateFlashcardContentData {
  type?: FlashcardType;
  front?: string;
  back?: string;
  translation?: string | null;
  example?: string | null;
  personal_example?: string | null;
  notes?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  level?: EnglishLevel | null;
  tags?: string[];
}

interface UpdateSchedulingStateData {
  status: FlashcardStatus;
  next_review_at: Date;
  interval_minutes: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
}

interface FindDueOptions {
  limit?: number;
  offset?: number;
}

class FlashcardsRepository {
  private readonly flashcardRepo: Repository<Flashcard>;

  constructor(dataSource: DataSource | EntityManager) {
    this.flashcardRepo = dataSource.getRepository(Flashcard);
  }

  async createFlashcard(data: CreateFlashcardData): Promise<Flashcard> {
    const flashcard = this.flashcardRepo.create({
      user_id: data.userId,
      deck_id: data.deckId,
      type: data.type,
      front: data.front,
      back: data.back,
      translation: data.translation,
      example: data.example,
      personal_example: data.personalExample,
      notes: data.notes,
      source_name: data.sourceName,
      source_url: data.sourceUrl,
      level: data.level,
      tags: data.tags,
    });
    return this.flashcardRepo.save(flashcard);
  }

  async findActiveByIdAndUser(flashcardId: string, userId: string): Promise<Flashcard | null> {
    return this.flashcardRepo
      .createQueryBuilder('flashcard')
      .where('flashcard.id = :flashcardId', { flashcardId })
      .andWhere('flashcard.user_id = :userId', { userId })
      .andWhere('flashcard.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Bloquea la fila con SELECT ... FOR UPDATE. Requiere un EntityManager
   * transaccional (obtenido de dataSource.transaction(async manager => {...})) —
   * TypeORM lanza en runtime si se invoca fuera de una transacción activa.
   */
  async findByIdForUpdate(
    flashcardId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<Flashcard | null> {
    return manager
      .getRepository(Flashcard)
      .createQueryBuilder('flashcard')
      .setLock('pessimistic_write')
      .where('flashcard.id = :flashcardId', { flashcardId })
      .andWhere('flashcard.user_id = :userId', { userId })
      .andWhere('flashcard.deleted_at IS NULL')
      .getOne();
  }

  async findActiveByDeck(deckId: string, userId: string): Promise<Flashcard[]> {
    return this.flashcardRepo
      .createQueryBuilder('flashcard')
      .where('flashcard.deck_id = :deckId', { deckId })
      .andWhere('flashcard.user_id = :userId', { userId })
      .andWhere('flashcard.deleted_at IS NULL')
      .orderBy('flashcard.created_at', 'DESC')
      .getMany();
  }

  async findDuplicate(
    deckId: string,
    type: FlashcardType,
    front: string,
    back: string,
  ): Promise<Flashcard | null> {
    return this.flashcardRepo
      .createQueryBuilder('flashcard')
      .where('flashcard.deck_id = :deckId', { deckId })
      .andWhere('flashcard.type = :type', { type })
      .andWhere('LOWER(flashcard.front) = LOWER(:front)', { front })
      .andWhere('LOWER(flashcard.back) = LOWER(:back)', { back })
      .andWhere('flashcard.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Tarjetas pendientes de un usuario: tarjeta activa, mazo activo y no
   * archivado, no suspendida, vencida. No aplica meta diaria, mezcla de
   * mazos ni priorización — eso es responsabilidad del service.
   */
  async findDueByUser(userId: string, options: FindDueOptions = {}): Promise<Flashcard[]> {
    const qb = this.flashcardRepo
      .createQueryBuilder('flashcard')
      .innerJoin('flashcard.deck', 'deck')
      .where('flashcard.user_id = :userId', { userId })
      .andWhere('flashcard.deleted_at IS NULL')
      .andWhere('flashcard.status <> :suspended', { suspended: FlashcardStatus.SUSPENDED })
      .andWhere('flashcard.next_review_at <= now()')
      .andWhere('deck.deleted_at IS NULL')
      .andWhere('deck.is_archived = false')
      .orderBy('flashcard.next_review_at', 'ASC')
      .addOrderBy('flashcard.created_at', 'ASC');

    if (options.limit !== undefined) qb.take(options.limit);
    if (options.offset !== undefined) qb.skip(options.offset);

    return qb.getMany();
  }

  async countDueByUser(userId: string): Promise<number> {
    return this.flashcardRepo
      .createQueryBuilder('flashcard')
      .innerJoin('flashcard.deck', 'deck')
      .where('flashcard.user_id = :userId', { userId })
      .andWhere('flashcard.deleted_at IS NULL')
      .andWhere('flashcard.status <> :suspended', { suspended: FlashcardStatus.SUSPENDED })
      .andWhere('flashcard.next_review_at <= now()')
      .andWhere('deck.deleted_at IS NULL')
      .andWhere('deck.is_archived = false')
      .getCount();
  }

  async updateContent(
    flashcardId: string,
    userId: string,
    data: UpdateFlashcardContentData,
  ): Promise<UpdateResult> {
    return this.flashcardRepo.update(
      { id: flashcardId, user_id: userId, deleted_at: IsNull() },
      data,
    );
  }

  async updateSchedulingState(
    flashcardId: string,
    userId: string,
    data: UpdateSchedulingStateData,
  ): Promise<UpdateResult> {
    return this.flashcardRepo.update(
      { id: flashcardId, user_id: userId, deleted_at: IsNull() },
      {
        status: data.status,
        next_review_at: data.next_review_at,
        interval_minutes: data.interval_minutes,
        ease_factor: String(data.ease_factor),
        repetitions: data.repetitions,
        lapses: data.lapses,
      },
    );
  }

  async suspendFlashcard(flashcardId: string, userId: string): Promise<UpdateResult> {
    return this.flashcardRepo.update(
      { id: flashcardId, user_id: userId, deleted_at: IsNull() },
      { status: FlashcardStatus.SUSPENDED },
    );
  }

  async reactivateFlashcard(
    flashcardId: string,
    userId: string,
    status: FlashcardStatus,
  ): Promise<UpdateResult> {
    return this.flashcardRepo.update(
      { id: flashcardId, user_id: userId, deleted_at: IsNull() },
      { status },
    );
  }

  async softDeleteFlashcard(flashcardId: string, userId: string): Promise<UpdateResult> {
    return this.flashcardRepo.softDelete({
      id: flashcardId,
      user_id: userId,
      deleted_at: IsNull(),
    });
  }
}

export { FlashcardsRepository };
export type { CreateFlashcardData, UpdateFlashcardContentData, UpdateSchedulingStateData };
