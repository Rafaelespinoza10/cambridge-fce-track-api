import type { DataSource, UpdateResult } from 'typeorm';

import { DecksRepository } from '../repositories/decks.repository';
import type { CreateDeckData, UpdateDeckData } from '../repositories/decks.repository';
import type { Deck } from '../models/Deck';
import type {
  CreateDeckRequestBody,
  UpdateDeckRequestBody,
  DeckListStatus,
  DeckDto,
} from '../interfaces/decks.interface';

export enum DeckErrorCode {
  INVALID_INPUT = 'invalid_input',
  DECK_NOT_FOUND = 'deck_not_found',
  DECK_UPDATE_CONFLICT = 'deck_update_conflict',
  DECK_ARCHIVE_CONFLICT = 'deck_archive_conflict',
  DECK_DELETE_CONFLICT = 'deck_delete_conflict',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class DeckError extends Error {
  constructor(
    message: string,
    readonly code: DeckErrorCode,
  ) {
    super(message);
    this.name = 'DeckError';
  }
}

interface DecksRepositoryPort {
  createDeck(data: CreateDeckData): Promise<Deck>;
  findNonDeletedByIdAndUser(deckId: string, userId: string): Promise<Deck | null>;
  findAvailableByUser(userId: string): Promise<Deck[]>;
  findArchivedByUser(userId: string): Promise<Deck[]>;
  updateDeck(deckId: string, userId: string, data: UpdateDeckData): Promise<UpdateResult>;
  archiveDeck(deckId: string, userId: string): Promise<UpdateResult>;
  unarchiveDeck(deckId: string, userId: string): Promise<UpdateResult>;
  softDeleteDeck(deckId: string, userId: string): Promise<UpdateResult>;
}

interface DecksServiceDeps {
  decks: (dataSource: DataSource) => DecksRepositoryPort;
}

const DEFAULT_DEPS: DecksServiceDeps = {
  decks: (dataSource) => new DecksRepository(dataSource),
};

const NAME_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 2000;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DeckError('name must be a string', DeckErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new DeckError('name must not be empty', DeckErrorCode.INVALID_INPUT);
  }
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new DeckError(
      `name must be at most ${NAME_MAX_LENGTH} characters`,
      DeckErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeDescriptionValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    throw new DeckError('description must be a string', DeckErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new DeckError(
      `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
      DeckErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeColorValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    throw new DeckError('color must be a string', DeckErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!COLOR_PATTERN.test(trimmed)) {
    throw new DeckError('color must match #RRGGBB', DeckErrorCode.INVALID_INPUT);
  }
  return trimmed.toUpperCase();
}

function toDeckDto(deck: Deck): DeckDto {
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    color: deck.color,
    isArchived: deck.is_archived,
    createdAt: deck.created_at,
    updatedAt: deck.updated_at,
  };
}

class DecksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: DecksServiceDeps = DEFAULT_DEPS,
  ) {}

  private repo(): DecksRepositoryPort {
    return this.deps.decks(this.dataSource);
  }

  async createDeck(userId: string, input: CreateDeckRequestBody): Promise<DeckDto> {
    const name = normalizeName(input.name);
    const description =
      input.description === undefined ? null : normalizeDescriptionValue(input.description);
    const color = input.color === undefined ? null : normalizeColorValue(input.color);

    const deck = await this.repo().createDeck({ userId, name, description, color });
    return toDeckDto(deck);
  }

  async listDecks(userId: string, status: DeckListStatus): Promise<DeckDto[]> {
    const decks =
      status === 'archived'
        ? await this.repo().findArchivedByUser(userId)
        : await this.repo().findAvailableByUser(userId);
    return decks.map(toDeckDto);
  }

  async getDeck(userId: string, deckId: string): Promise<DeckDto> {
    const deck = await this.repo().findNonDeletedByIdAndUser(deckId, userId);
    if (deck === null) {
      throw new DeckError('Deck not found', DeckErrorCode.DECK_NOT_FOUND);
    }
    return toDeckDto(deck);
  }

  async updateDeck(userId: string, deckId: string, input: UpdateDeckRequestBody): Promise<DeckDto> {
    const updateData: UpdateDeckData = {};

    if (input.name !== undefined) {
      updateData.name = normalizeName(input.name);
    }
    if (input.description !== undefined) {
      updateData.description =
        input.description === null ? null : normalizeDescriptionValue(input.description);
    }
    if (input.color !== undefined) {
      updateData.color = input.color === null ? null : normalizeColorValue(input.color);
    }

    if (Object.keys(updateData).length === 0) {
      throw new DeckError('At least one field must be provided', DeckErrorCode.INVALID_INPUT);
    }

    const result = await this.repo().updateDeck(deckId, userId, updateData);
    if (result.affected !== 1) {
      throw new DeckError('Deck not found', DeckErrorCode.DECK_NOT_FOUND);
    }

    const updated = await this.repo().findNonDeletedByIdAndUser(deckId, userId);
    if (updated === null) {
      throw new DeckError('Deck disappeared after update', DeckErrorCode.PERSISTENCE_INCONSISTENCY);
    }
    return toDeckDto(updated);
  }

  async archiveDeck(userId: string, deckId: string): Promise<DeckDto> {
    const result = await this.repo().archiveDeck(deckId, userId);
    if (result.affected !== 1) {
      throw new DeckError('Deck not found', DeckErrorCode.DECK_NOT_FOUND);
    }
    const updated = await this.repo().findNonDeletedByIdAndUser(deckId, userId);
    if (updated === null) {
      throw new DeckError(
        'Deck disappeared after archiving',
        DeckErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return toDeckDto(updated);
  }

  async unarchiveDeck(userId: string, deckId: string): Promise<DeckDto> {
    const result = await this.repo().unarchiveDeck(deckId, userId);
    if (result.affected !== 1) {
      throw new DeckError('Deck not found', DeckErrorCode.DECK_NOT_FOUND);
    }
    const updated = await this.repo().findNonDeletedByIdAndUser(deckId, userId);
    if (updated === null) {
      throw new DeckError(
        'Deck disappeared after unarchiving',
        DeckErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return toDeckDto(updated);
  }

  async deleteDeck(userId: string, deckId: string): Promise<void> {
    const result = await this.repo().softDeleteDeck(deckId, userId);
    if (result.affected !== 1) {
      throw new DeckError('Deck not found', DeckErrorCode.DECK_NOT_FOUND);
    }
  }
}

export { DecksService };
export type { DecksRepositoryPort, DecksServiceDeps };
