import { IsNull } from 'typeorm';
import type { DataSource, EntityManager, Repository, UpdateResult } from 'typeorm';
import { Deck } from '../models/Deck';

interface CreateDeckData {
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
}

interface UpdateDeckData {
  name?: string;
  description?: string | null;
  color?: string | null;
}

class DecksRepository {
  private readonly deckRepo: Repository<Deck>;

  constructor(dataSource: DataSource | EntityManager) {
    this.deckRepo = dataSource.getRepository(Deck);
  }

  async createDeck(data: CreateDeckData): Promise<Deck> {
    const deck = this.deckRepo.create({
      user_id: data.userId,
      name: data.name,
      description: data.description,
      color: data.color,
    });
    return this.deckRepo.save(deck);
  }

  async findActiveByIdAndUser(deckId: string, userId: string): Promise<Deck | null> {
    return this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.id = :deckId', { deckId })
      .andWhere('deck.user_id = :userId', { userId })
      .andWhere('deck.deleted_at IS NULL')
      .getOne();
  }

  async findNonDeletedByIdAndUser(deckId: string, userId: string): Promise<Deck | null> {
    return this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.id = :deckId', { deckId })
      .andWhere('deck.user_id = :userId', { userId })
      .andWhere('deck.deleted_at IS NULL')
      .getOne();
  }

  async findAvailableByUser(userId: string): Promise<Deck[]> {
    return this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.user_id = :userId', { userId })
      .andWhere('deck.deleted_at IS NULL')
      .andWhere('deck.is_archived = false')
      .orderBy('deck.created_at', 'DESC')
      .getMany();
  }

  async findArchivedByUser(userId: string): Promise<Deck[]> {
    return this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.user_id = :userId', { userId })
      .andWhere('deck.deleted_at IS NULL')
      .andWhere('deck.is_archived = true')
      .orderBy('deck.created_at', 'DESC')
      .getMany();
  }

  async existsActiveByIdAndUser(deckId: string, userId: string): Promise<boolean> {
    const count = await this.deckRepo
      .createQueryBuilder('deck')
      .where('deck.id = :deckId', { deckId })
      .andWhere('deck.user_id = :userId', { userId })
      .andWhere('deck.deleted_at IS NULL')
      .getCount();
    return count > 0;
  }

  async updateDeck(deckId: string, userId: string, data: UpdateDeckData): Promise<UpdateResult> {
    return this.deckRepo.update({ id: deckId, user_id: userId, deleted_at: IsNull() }, data);
  }

  async archiveDeck(deckId: string, userId: string): Promise<UpdateResult> {
    return this.deckRepo.update(
      { id: deckId, user_id: userId, deleted_at: IsNull() },
      { is_archived: true },
    );
  }

  async unarchiveDeck(deckId: string, userId: string): Promise<UpdateResult> {
    return this.deckRepo.update(
      { id: deckId, user_id: userId, deleted_at: IsNull() },
      { is_archived: false },
    );
  }

  async softDeleteDeck(deckId: string, userId: string): Promise<UpdateResult> {
    return this.deckRepo.softDelete({ id: deckId, user_id: userId, deleted_at: IsNull() });
  }
}

export { DecksRepository };
export type { CreateDeckData, UpdateDeckData };
