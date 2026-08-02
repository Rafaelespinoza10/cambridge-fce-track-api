import type { DataSource, UpdateResult } from 'typeorm';

import { FlashcardsRepository } from '../repositories/flashcards.repository';
import type {
  CreateFlashcardData,
  UpdateFlashcardContentData,
  FindByDeckFilters,
} from '../repositories/flashcards.repository';
import { DecksRepository } from '../repositories/decks.repository';
import type { Flashcard } from '../models/Flashcard';
import type { Deck } from '../models/Deck';
import { FlashcardType, FlashcardStatus, EnglishLevel } from '../models/enums';
import type {
  CreateFlashcardRequestBody,
  UpdateFlashcardRequestBody,
  FlashcardListStatus,
  FlashcardDto,
} from '../interfaces/flashcards.interface';

export enum FlashcardErrorCode {
  INVALID_INPUT = 'invalid_input',
  DECK_NOT_FOUND = 'deck_not_found',
  DECK_UNAVAILABLE = 'deck_unavailable',
  FLASHCARD_NOT_FOUND = 'flashcard_not_found',
  FLASHCARD_DUPLICATE = 'flashcard_duplicate',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class FlashcardError extends Error {
  constructor(
    message: string,
    readonly code: FlashcardErrorCode,
  ) {
    super(message);
    this.name = 'FlashcardError';
  }
}

interface FlashcardsRepositoryPort {
  createFlashcard(data: CreateFlashcardData): Promise<Flashcard>;
  findActiveByIdAndUser(flashcardId: string, userId: string): Promise<Flashcard | null>;
  findByDeckForUser(
    deckId: string,
    userId: string,
    filters: FindByDeckFilters,
  ): Promise<Flashcard[]>;
  findDuplicate(
    deckId: string,
    type: FlashcardType,
    front: string,
    back: string,
    excludeId?: string,
  ): Promise<Flashcard | null>;
  updateContent(
    flashcardId: string,
    userId: string,
    data: UpdateFlashcardContentData,
  ): Promise<UpdateResult>;
  suspendFlashcard(flashcardId: string, userId: string): Promise<UpdateResult>;
  reactivateFlashcard(
    flashcardId: string,
    userId: string,
    status: FlashcardStatus,
  ): Promise<UpdateResult>;
  softDeleteFlashcard(flashcardId: string, userId: string): Promise<UpdateResult>;
}

interface DecksRepositoryPort {
  findActiveByIdAndUser(deckId: string, userId: string): Promise<Deck | null>;
}

interface FlashcardsServiceDeps {
  flashcards: (dataSource: DataSource) => FlashcardsRepositoryPort;
  decks: (dataSource: DataSource) => DecksRepositoryPort;
}

const DEFAULT_DEPS: FlashcardsServiceDeps = {
  flashcards: (dataSource) => new FlashcardsRepository(dataSource),
  decks: (dataSource) => new DecksRepository(dataSource),
};

const FRONT_MAX_LENGTH = 500;
const BACK_MAX_LENGTH = 500;
const TRANSLATION_MAX_LENGTH = 500;
const EXAMPLE_MAX_LENGTH = 2000;
const PERSONAL_EXAMPLE_MAX_LENGTH = 2000;
const NOTES_MAX_LENGTH = 5000;
const SOURCE_NAME_MAX_LENGTH = 255;
const SOURCE_URL_MAX_LENGTH = 2000;
const TAGS_MAX_COUNT = 20;
const TAG_MAX_LENGTH = 50;

const ALLOWED_SOURCE_URL_PROTOCOLS = new Set(['http:', 'https:']);
const VALID_FLASHCARD_TYPES = new Set<string>(Object.values(FlashcardType));
const VALID_ENGLISH_LEVELS = new Set<string>(Object.values(EnglishLevel));

const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const DEDUPE_CONSTRAINT_NAME = 'uq_flashcards_dedupe';

function isDedupeConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === DEDUPE_CONSTRAINT_NAME;
}

function normalizeRequiredField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new FlashcardError(`${field} must be a string`, FlashcardErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new FlashcardError(`${field} must not be empty`, FlashcardErrorCode.INVALID_INPUT);
  }
  if (trimmed.length > maxLength) {
    throw new FlashcardError(
      `${field} must be at most ${maxLength} characters`,
      FlashcardErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeOptionalField(value: unknown, field: string, maxLength: number): string | null {
  if (typeof value !== 'string') {
    throw new FlashcardError(`${field} must be a string`, FlashcardErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLength) {
    throw new FlashcardError(
      `${field} must be at most ${maxLength} characters`,
      FlashcardErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeType(value: unknown): FlashcardType {
  if (typeof value !== 'string' || !VALID_FLASHCARD_TYPES.has(value)) {
    throw new FlashcardError(
      'type must be a valid flashcard type',
      FlashcardErrorCode.INVALID_INPUT,
    );
  }
  return value as FlashcardType;
}

function normalizeLevelValue(value: unknown): EnglishLevel {
  if (typeof value !== 'string' || !VALID_ENGLISH_LEVELS.has(value)) {
    throw new FlashcardError(
      'level must be a valid English level',
      FlashcardErrorCode.INVALID_INPUT,
    );
  }
  return value as EnglishLevel;
}

function normalizeSourceUrlValue(value: unknown): string | null {
  const trimmed = normalizeOptionalField(value, 'sourceUrl', SOURCE_URL_MAX_LENGTH);
  if (trimmed === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FlashcardError('sourceUrl must be a valid URL', FlashcardErrorCode.INVALID_INPUT);
  }
  if (!ALLOWED_SOURCE_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new FlashcardError('sourceUrl must use http or https', FlashcardErrorCode.INVALID_INPUT);
  }
  return trimmed;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new FlashcardError('tags must be an array of strings', FlashcardErrorCode.INVALID_INPUT);
  }
  if (value.length > TAGS_MAX_COUNT) {
    throw new FlashcardError(
      `tags must contain at most ${TAGS_MAX_COUNT} items`,
      FlashcardErrorCode.INVALID_INPUT,
    );
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new FlashcardError('each tag must be a string', FlashcardErrorCode.INVALID_INPUT);
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
      throw new FlashcardError('tags must not be empty', FlashcardErrorCode.INVALID_INPUT);
    }
    if (trimmed.length > TAG_MAX_LENGTH) {
      throw new FlashcardError(
        `each tag must be at most ${TAG_MAX_LENGTH} characters`,
        FlashcardErrorCode.INVALID_INPUT,
      );
    }
    const normalized = trimmed.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      tags.push(normalized);
    }
  }
  return tags;
}

function toFlashcardDto(flashcard: Flashcard): FlashcardDto {
  return {
    id: flashcard.id,
    deckId: flashcard.deck_id,
    type: flashcard.type,
    front: flashcard.front,
    back: flashcard.back,
    translation: flashcard.translation,
    example: flashcard.example,
    personalExample: flashcard.personal_example,
    notes: flashcard.notes,
    sourceName: flashcard.source_name,
    sourceUrl: flashcard.source_url,
    level: flashcard.level,
    tags: flashcard.tags,
    status: flashcard.status,
    nextReviewAt: flashcard.next_review_at,
    intervalMinutes: flashcard.interval_minutes,
    easeFactor: Number(flashcard.ease_factor),
    repetitions: flashcard.repetitions,
    lapses: flashcard.lapses,
    createdAt: flashcard.created_at,
    updatedAt: flashcard.updated_at,
  };
}

class FlashcardsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: FlashcardsServiceDeps = DEFAULT_DEPS,
  ) {}

  private flashcardsRepo(): FlashcardsRepositoryPort {
    return this.deps.flashcards(this.dataSource);
  }

  private decksRepo(): DecksRepositoryPort {
    return this.deps.decks(this.dataSource);
  }

  async createFlashcard(
    userId: string,
    deckId: string,
    now: Date,
    input: CreateFlashcardRequestBody,
  ): Promise<FlashcardDto> {
    const type = normalizeType(input.type);
    const front = normalizeRequiredField(input.front, 'front', FRONT_MAX_LENGTH);
    const back = normalizeRequiredField(input.back, 'back', BACK_MAX_LENGTH);
    const translation =
      input.translation === undefined
        ? null
        : normalizeOptionalField(input.translation, 'translation', TRANSLATION_MAX_LENGTH);
    const example =
      input.example === undefined
        ? null
        : normalizeOptionalField(input.example, 'example', EXAMPLE_MAX_LENGTH);
    const personalExample =
      input.personalExample === undefined
        ? null
        : normalizeOptionalField(
            input.personalExample,
            'personalExample',
            PERSONAL_EXAMPLE_MAX_LENGTH,
          );
    const notes =
      input.notes === undefined
        ? null
        : normalizeOptionalField(input.notes, 'notes', NOTES_MAX_LENGTH);
    const sourceName =
      input.sourceName === undefined
        ? null
        : normalizeOptionalField(input.sourceName, 'sourceName', SOURCE_NAME_MAX_LENGTH);
    const sourceUrl =
      input.sourceUrl === undefined ? null : normalizeSourceUrlValue(input.sourceUrl);
    const level = input.level === undefined ? null : normalizeLevelValue(input.level);
    const tags = input.tags === undefined ? [] : normalizeTags(input.tags);

    const deck = await this.decksRepo().findActiveByIdAndUser(deckId, userId);
    if (deck === null) {
      throw new FlashcardError('Deck not found', FlashcardErrorCode.DECK_NOT_FOUND);
    }
    if (deck.is_archived) {
      throw new FlashcardError(
        'Cannot create a flashcard in an archived deck',
        FlashcardErrorCode.DECK_UNAVAILABLE,
      );
    }

    const duplicate = await this.flashcardsRepo().findDuplicate(deckId, type, front, back);
    if (duplicate !== null) {
      throw new FlashcardError(
        'A flashcard with this front/back already exists in this deck',
        FlashcardErrorCode.FLASHCARD_DUPLICATE,
      );
    }

    try {
      const flashcard = await this.flashcardsRepo().createFlashcard({
        userId,
        deckId,
        type,
        front,
        back,
        translation,
        example,
        personalExample,
        notes,
        sourceName,
        sourceUrl,
        level,
        tags,
        nextReviewAt: now,
      });
      return toFlashcardDto(flashcard);
    } catch (error) {
      if (isDedupeConstraintViolation(error)) {
        throw new FlashcardError(
          'A flashcard with this front/back already exists in this deck',
          FlashcardErrorCode.FLASHCARD_DUPLICATE,
        );
      }
      throw error;
    }
  }

  async listFlashcards(
    userId: string,
    deckId: string,
    status: FlashcardListStatus,
    type?: FlashcardType,
  ): Promise<FlashcardDto[]> {
    const deck = await this.decksRepo().findActiveByIdAndUser(deckId, userId);
    if (deck === null) {
      throw new FlashcardError('Deck not found', FlashcardErrorCode.DECK_NOT_FOUND);
    }

    const filters: FindByDeckFilters = type === undefined ? { status } : { status, type };
    const flashcards = await this.flashcardsRepo().findByDeckForUser(deckId, userId, filters);
    return flashcards.map(toFlashcardDto);
  }

  async getFlashcard(userId: string, flashcardId: string): Promise<FlashcardDto> {
    const flashcard = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (flashcard === null) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }

    const deck = await this.decksRepo().findActiveByIdAndUser(flashcard.deck_id, userId);
    if (deck === null) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }

    return toFlashcardDto(flashcard);
  }

  async updateFlashcard(
    userId: string,
    flashcardId: string,
    input: UpdateFlashcardRequestBody,
  ): Promise<FlashcardDto> {
    const updateData: UpdateFlashcardContentData = {};

    if (input.type !== undefined) {
      updateData.type = normalizeType(input.type);
    }
    if (input.front !== undefined) {
      updateData.front = normalizeRequiredField(input.front, 'front', FRONT_MAX_LENGTH);
    }
    if (input.back !== undefined) {
      updateData.back = normalizeRequiredField(input.back, 'back', BACK_MAX_LENGTH);
    }
    if (input.translation !== undefined) {
      updateData.translation =
        input.translation === null
          ? null
          : normalizeOptionalField(input.translation, 'translation', TRANSLATION_MAX_LENGTH);
    }
    if (input.example !== undefined) {
      updateData.example =
        input.example === null
          ? null
          : normalizeOptionalField(input.example, 'example', EXAMPLE_MAX_LENGTH);
    }
    if (input.personalExample !== undefined) {
      updateData.personal_example =
        input.personalExample === null
          ? null
          : normalizeOptionalField(
              input.personalExample,
              'personalExample',
              PERSONAL_EXAMPLE_MAX_LENGTH,
            );
    }
    if (input.notes !== undefined) {
      updateData.notes =
        input.notes === null
          ? null
          : normalizeOptionalField(input.notes, 'notes', NOTES_MAX_LENGTH);
    }
    if (input.sourceName !== undefined) {
      updateData.source_name =
        input.sourceName === null
          ? null
          : normalizeOptionalField(input.sourceName, 'sourceName', SOURCE_NAME_MAX_LENGTH);
    }
    if (input.sourceUrl !== undefined) {
      updateData.source_url =
        input.sourceUrl === null ? null : normalizeSourceUrlValue(input.sourceUrl);
    }
    if (input.level !== undefined) {
      updateData.level = input.level === null ? null : normalizeLevelValue(input.level);
    }
    if (input.tags !== undefined) {
      updateData.tags = normalizeTags(input.tags);
    }

    if (Object.keys(updateData).length === 0) {
      throw new FlashcardError(
        'At least one field must be provided',
        FlashcardErrorCode.INVALID_INPUT,
      );
    }

    const existing = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (existing === null) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }

    const nextType = updateData.type ?? existing.type;
    const nextFront = updateData.front ?? existing.front;
    const nextBack = updateData.back ?? existing.back;

    const duplicate = await this.flashcardsRepo().findDuplicate(
      existing.deck_id,
      nextType,
      nextFront,
      nextBack,
      flashcardId,
    );
    if (duplicate !== null) {
      throw new FlashcardError(
        'A flashcard with this front/back already exists in this deck',
        FlashcardErrorCode.FLASHCARD_DUPLICATE,
      );
    }

    let result: UpdateResult;
    try {
      result = await this.flashcardsRepo().updateContent(flashcardId, userId, updateData);
    } catch (error) {
      if (isDedupeConstraintViolation(error)) {
        throw new FlashcardError(
          'A flashcard with this front/back already exists in this deck',
          FlashcardErrorCode.FLASHCARD_DUPLICATE,
        );
      }
      throw error;
    }
    if (result.affected !== 1) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }

    const updated = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (updated === null) {
      throw new FlashcardError(
        'Flashcard disappeared after update',
        FlashcardErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return toFlashcardDto(updated);
  }

  async suspendFlashcard(userId: string, flashcardId: string): Promise<FlashcardDto> {
    const existing = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (existing === null) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }

    if (existing.status !== FlashcardStatus.SUSPENDED) {
      const result = await this.flashcardsRepo().suspendFlashcard(flashcardId, userId);
      if (result.affected !== 1) {
        throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
      }
    }

    const updated = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (updated === null) {
      throw new FlashcardError(
        'Flashcard disappeared after suspending',
        FlashcardErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return toFlashcardDto(updated);
  }

  async reactivateFlashcard(userId: string, flashcardId: string): Promise<FlashcardDto> {
    const existing = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (existing === null) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }

    if (existing.status === FlashcardStatus.SUSPENDED) {
      const nextStatus =
        existing.repetitions > 0 || existing.interval_minutes > 0
          ? FlashcardStatus.REVIEW
          : FlashcardStatus.NEW;
      const result = await this.flashcardsRepo().reactivateFlashcard(
        flashcardId,
        userId,
        nextStatus,
      );
      if (result.affected !== 1) {
        throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
      }
    }

    const updated = await this.flashcardsRepo().findActiveByIdAndUser(flashcardId, userId);
    if (updated === null) {
      throw new FlashcardError(
        'Flashcard disappeared after reactivating',
        FlashcardErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    return toFlashcardDto(updated);
  }

  async deleteFlashcard(userId: string, flashcardId: string): Promise<void> {
    const result = await this.flashcardsRepo().softDeleteFlashcard(flashcardId, userId);
    if (result.affected !== 1) {
      throw new FlashcardError('Flashcard not found', FlashcardErrorCode.FLASHCARD_NOT_FOUND);
    }
  }
}

export { FlashcardsService };
export type { FlashcardsRepositoryPort, DecksRepositoryPort, FlashcardsServiceDeps };
