import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager, UpdateResult } from 'typeorm';

import { FlashcardsService, FlashcardError, FlashcardErrorCode } from './flashcards.service';
import type {
  FlashcardsRepositoryPort,
  DecksRepositoryPort,
  FlashcardsServiceDeps,
} from './flashcards.service';
import type { Flashcard } from '../../models/Flashcard';
import type { Deck } from '../../models/Deck';
import { FlashcardType, FlashcardStatus } from '../../models/enums';
import type {
  CreateFlashcardData,
  UpdateFlashcardContentData,
  FindByDeckFilters,
} from '@repositories/flashcards/flashcards.repository';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const DECK_ID = 'deck-1';
const FLASHCARD_ID = 'card-1';
const NOW = new Date('2026-01-15T00:00:00.000Z');

const OK_RESULT: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
const NO_MATCH_RESULT: UpdateResult = { affected: 0, raw: [], generatedMaps: [] };

const DEDUPE_VIOLATION = Object.assign(
  new Error('duplicate key value violates unique constraint'),
  {
    code: '23505',
    constraint: 'uq_flashcards_dedupe',
  },
);

const UNRELATED_VIOLATION = Object.assign(
  new Error('duplicate key value violates unique constraint'),
  {
    code: '23505',
    constraint: 'some_other_constraint',
  },
);

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: DECK_ID,
    user_id: USER_ID,
    name: 'Phrasal verbs',
    description: null,
    color: null,
    is_archived: false,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...overrides,
  } as Deck;
}

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: FLASHCARD_ID,
    user_id: USER_ID,
    deck_id: DECK_ID,
    type: FlashcardType.VOCABULARY,
    front: 'Ubiquitous',
    back: 'Presente en todas partes',
    translation: null,
    example: null,
    personal_example: null,
    notes: null,
    source_name: null,
    source_url: null,
    level: null,
    tags: [],
    status: FlashcardStatus.NEW,
    next_review_at: NOW,
    interval_minutes: 0,
    ease_factor: '2.50',
    repetitions: 0,
    lapses: 0,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...overrides,
  } as Flashcard;
}

interface MutationCallCounts {
  createFlashcard: number;
  updateContent: number;
  suspendFlashcard: number;
  reactivateFlashcard: number;
  softDeleteFlashcard: number;
}

interface World {
  decks: Deck[];
  flashcards: Flashcard[];
  queuedCreateError?: Error;
  queuedUpdateError?: Error;
  mutationCalls: MutationCallCounts;
}

function createWorld(overrides: Partial<World> = {}): World {
  return {
    decks: [makeDeck()],
    flashcards: [],
    mutationCalls: {
      createFlashcard: 0,
      updateContent: 0,
      suspendFlashcard: 0,
      reactivateFlashcard: 0,
      softDeleteFlashcard: 0,
    },
    ...overrides,
  };
}

let idCounter = 0;

function buildFakeDecksRepo(world: World): DecksRepositoryPort {
  return {
    findActiveByIdAndUser: async (deckId, userId) => {
      const found = world.decks.find(
        (d) => d.id === deckId && d.user_id === userId && d.deleted_at === null,
      );
      return found ?? null;
    },
  };
}

function buildFakeFlashcardsRepo(world: World): FlashcardsRepositoryPort {
  return {
    createFlashcard: async (data: CreateFlashcardData) => {
      world.mutationCalls.createFlashcard += 1;
      if (world.queuedCreateError) {
        const error = world.queuedCreateError;
        world.queuedCreateError = undefined;
        throw error;
      }
      idCounter += 1;
      const flashcard = makeFlashcard({
        id: `created-${idCounter}`,
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
        next_review_at: data.nextReviewAt,
      });
      world.flashcards.push(flashcard);
      return flashcard;
    },
    findActiveByIdAndUser: async (flashcardId, userId) => {
      const found = world.flashcards.find(
        (f) => f.id === flashcardId && f.user_id === userId && f.deleted_at === null,
      );
      return found ?? null;
    },
    findByDeckForUser: async (deckId, userId, filters: FindByDeckFilters) => {
      let result = world.flashcards.filter(
        (f) => f.deck_id === deckId && f.user_id === userId && f.deleted_at === null,
      );
      if (filters.status === 'active') {
        result = result.filter((f) => f.status !== FlashcardStatus.SUSPENDED);
      } else if (filters.status === 'suspended') {
        result = result.filter((f) => f.status === FlashcardStatus.SUSPENDED);
      }
      if (filters.type !== undefined) {
        result = result.filter((f) => f.type === filters.type);
      }
      return result
        .slice()
        .sort(
          (a, b) => b.created_at.getTime() - a.created_at.getTime() || a.id.localeCompare(b.id),
        );
    },
    findDuplicate: async (deckId, type, front, back, excludeId) => {
      const found = world.flashcards.find(
        (f) =>
          f.deck_id === deckId &&
          f.type === type &&
          f.front.toLowerCase() === front.toLowerCase() &&
          f.back.toLowerCase() === back.toLowerCase() &&
          f.deleted_at === null &&
          f.id !== excludeId,
      );
      return found ?? null;
    },
    updateContent: async (flashcardId, userId, data: UpdateFlashcardContentData) => {
      world.mutationCalls.updateContent += 1;
      if (world.queuedUpdateError) {
        const error = world.queuedUpdateError;
        world.queuedUpdateError = undefined;
        throw error;
      }
      const flashcard = world.flashcards.find(
        (f) => f.id === flashcardId && f.user_id === userId && f.deleted_at === null,
      );
      if (flashcard === undefined) return NO_MATCH_RESULT;
      Object.assign(flashcard, data, { updated_at: new Date() });
      return OK_RESULT;
    },
    suspendFlashcard: async (flashcardId, userId) => {
      world.mutationCalls.suspendFlashcard += 1;
      const flashcard = world.flashcards.find(
        (f) => f.id === flashcardId && f.user_id === userId && f.deleted_at === null,
      );
      if (flashcard === undefined) return NO_MATCH_RESULT;
      flashcard.status = FlashcardStatus.SUSPENDED;
      return OK_RESULT;
    },
    reactivateFlashcard: async (flashcardId, userId, status) => {
      world.mutationCalls.reactivateFlashcard += 1;
      const flashcard = world.flashcards.find(
        (f) => f.id === flashcardId && f.user_id === userId && f.deleted_at === null,
      );
      if (flashcard === undefined) return NO_MATCH_RESULT;
      flashcard.status = status;
      return OK_RESULT;
    },
    softDeleteFlashcard: async (flashcardId, userId) => {
      world.mutationCalls.softDeleteFlashcard += 1;
      const flashcard = world.flashcards.find(
        (f) => f.id === flashcardId && f.user_id === userId && f.deleted_at === null,
      );
      if (flashcard === undefined) return NO_MATCH_RESULT;
      flashcard.deleted_at = new Date();
      return OK_RESULT;
    },
  };
}

/** DataSource falso: simula rollback real restaurando el snapshot del mundo si `fn` lanza. */
function buildFakeDataSource(world: World): DataSource {
  const managerMarker = { __marker: 'fake-entity-manager' } as unknown as EntityManager;
  return {
    transaction: async <T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(world);
      try {
        return await fn(managerMarker);
      } catch (error) {
        Object.assign(world, snapshot);
        throw error;
      }
    },
  } as unknown as DataSource;
}

function setup(worldOverrides: Partial<World> = {}) {
  const world = createWorld(worldOverrides);
  const flashcardsRepo = buildFakeFlashcardsRepo(world);
  const decksRepo = buildFakeDecksRepo(world);
  const deps: FlashcardsServiceDeps = { flashcards: () => flashcardsRepo, decks: () => decksRepo };
  const service = new FlashcardsService(buildFakeDataSource(world), deps);
  return { world, flashcardsRepo, decksRepo, service };
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof FlashcardError && error.code === FlashcardErrorCode.INVALID_INPUT;
}

// ── Crear ────────────────────────────────────────────────────────────────────────

describe('FlashcardsService.createFlashcard', () => {
  it('creates each allowed type', async () => {
    const { service } = setup();
    for (const type of Object.values(FlashcardType)) {
      const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, {
        type,
        front: `front-${type}`,
        back: `back-${type}`,
      });
      assert.equal(card.type, type);
    }
  });

  it('initializes scheduling correctly', async () => {
    const { service } = setup();
    const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, {
      type: FlashcardType.VOCABULARY,
      front: 'Front',
      back: 'Back',
    });
    assert.equal(card.status, FlashcardStatus.NEW);
    assert.deepEqual(card.nextReviewAt, NOW);
    assert.equal(card.intervalMinutes, 0);
    assert.equal(card.easeFactor, 2.5);
    assert.equal(card.repetitions, 0);
    assert.equal(card.lapses, 0);
  });

  it('normalizes (trims) front/back', async () => {
    const { service } = setup();
    const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, {
      type: FlashcardType.VOCABULARY,
      front: '  Front  ',
      back: '  Back  ',
    });
    assert.equal(card.front, 'Front');
    assert.equal(card.back, 'Back');
  });

  it('normalizes optional fields (trim, empty -> null)', async () => {
    const { service } = setup();
    const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, {
      type: FlashcardType.VOCABULARY,
      front: 'Front',
      back: 'Back',
      translation: '  hola  ',
      example: '   ',
      notes: '',
    });
    assert.equal(card.translation, 'hola');
    assert.equal(card.example, null);
    assert.equal(card.notes, null);
  });

  it('normalizes and deduplicates tags, preserving stable order', async () => {
    const { service } = setup();
    const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, {
      type: FlashcardType.VOCABULARY,
      front: 'Front',
      back: 'Back',
      tags: ['  Grammar  ', 'grammar', 'B2', 'grammar'],
    });
    assert.deepEqual(card.tags, ['grammar', 'b2']);
  });

  it('rejects a tags array with more than 20 items', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
          tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
        }),
      isInvalidInput,
    );
  });

  it('validates level against the enum', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
          level: 'Z9' as never,
        }),
      isInvalidInput,
    );
  });

  it('validates sourceUrl protocol', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
          sourceUrl: 'javascript:alert(1)',
        }),
      isInvalidInput,
    );
  });

  it('rejects a malformed sourceUrl', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
          sourceUrl: 'not a url',
        }),
      isInvalidInput,
    );
  });

  it('accepts a valid http/https sourceUrl', async () => {
    const { service } = setup();
    const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, {
      type: FlashcardType.VOCABULARY,
      front: 'Front',
      back: 'Back',
      sourceUrl: 'https://example.com/article',
    });
    assert.equal(card.sourceUrl, 'https://example.com/article');
  });

  it('rejects an empty front', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: '   ',
          back: 'Back',
        }),
      isInvalidInput,
    );
  });

  it('rejects a nonexistent deck', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, 'missing-deck', NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_NOT_FOUND,
    );
  });

  it("rejects another user's deck", async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createFlashcard(OTHER_USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_NOT_FOUND,
    );
  });

  it('rejects an archived deck', async () => {
    const { service } = setup({ decks: [makeDeck({ is_archived: true })] });
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_UNAVAILABLE,
    );
  });

  it('detects a duplicate via the pre-check', async () => {
    const { service } = setup({
      flashcards: [makeFlashcard({ front: 'Front', back: 'Back' })],
    });
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'front',
          back: 'back',
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_DUPLICATE,
    );
  });

  it('translates a race-condition constraint violation into FLASHCARD_DUPLICATE', async () => {
    const { service } = setup({ queuedCreateError: DEDUPE_VIOLATION });
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_DUPLICATE,
    );
  });

  it('does not convert an unrelated 23505 into a duplicate error', async () => {
    const { service } = setup({ queuedCreateError: UNRELATED_VIOLATION });
    await assert.rejects(
      () =>
        service.createFlashcard(USER_ID, DECK_ID, NOW, {
          type: FlashcardType.VOCABULARY,
          front: 'Front',
          back: 'Back',
        }),
      (error: unknown) => error === UNRELATED_VIOLATION,
    );
  });

  it('never lets the client control scheduling fields', async () => {
    const { service } = setup();
    const maliciousInput = {
      type: FlashcardType.VOCABULARY,
      front: 'Front',
      back: 'Back',
      status: FlashcardStatus.REVIEW,
      repetitions: 99,
    } as unknown as Parameters<typeof service.createFlashcard>[3];
    const card = await service.createFlashcard(USER_ID, DECK_ID, NOW, maliciousInput);
    assert.equal(card.status, FlashcardStatus.NEW);
    assert.equal(card.repetitions, 0);
  });
});

// ── Familias de palabras ─────────────────────────────────────────────────────────

describe('FlashcardsService.createWordFamily', () => {
  it('creates one card per derivative, tagged with the shared family tag', async () => {
    const { service } = setup();
    const family = await service.createWordFamily(USER_ID, DECK_ID, NOW, {
      baseWord: 'happy',
      derivatives: [
        { form: 'happiness', partOfSpeech: 'noun' },
        { form: 'unhappy', partOfSpeech: 'adjective (negative)' },
        { form: 'happily', partOfSpeech: 'adverb' },
      ],
    });
    assert.equal(family.baseWord, 'happy');
    assert.equal(family.familyTag, 'family:happy');
    assert.equal(family.derivatives.length, 3);
    for (const card of family.derivatives) {
      assert.equal(card.type, FlashcardType.WORD_FORMATION);
      assert.deepEqual(card.tags, ['family:happy']);
    }
    assert.equal(family.derivatives[0].front, 'happy → noun');
    assert.equal(family.derivatives[0].back, 'happiness');
  });

  it('slugifies the base word for the family tag', async () => {
    const { service } = setup();
    const family = await service.createWordFamily(USER_ID, DECK_ID, NOW, {
      baseWord: '  Well-Being  ',
      derivatives: [{ form: 'wellbeing', partOfSpeech: 'noun' }],
    });
    assert.equal(family.familyTag, 'family:well-being');
  });

  it('rejects an empty baseWord', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createWordFamily(USER_ID, DECK_ID, NOW, {
          baseWord: '   ',
          derivatives: [{ form: 'x', partOfSpeech: 'noun' }],
        }),
      isInvalidInput,
    );
  });

  it('rejects an empty derivatives array', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createWordFamily(USER_ID, DECK_ID, NOW, { baseWord: 'happy', derivatives: [] }),
      isInvalidInput,
    );
  });

  it('rejects more than 20 derivatives', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createWordFamily(USER_ID, DECK_ID, NOW, {
          baseWord: 'happy',
          derivatives: Array.from({ length: 21 }, (_, i) => ({
            form: `form-${i}`,
            partOfSpeech: 'noun',
          })),
        }),
      isInvalidInput,
    );
  });

  it('rejects repeated part-of-speech/form pairs within the same request', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createWordFamily(USER_ID, DECK_ID, NOW, {
          baseWord: 'happy',
          derivatives: [
            { form: 'happiness', partOfSpeech: 'noun' },
            { form: 'Happiness', partOfSpeech: 'Noun' },
          ],
        }),
      isInvalidInput,
    );
  });

  it('rejects a nonexistent deck', async () => {
    const { service } = setup();
    await assert.rejects(
      () =>
        service.createWordFamily(USER_ID, 'missing-deck', NOW, {
          baseWord: 'happy',
          derivatives: [{ form: 'happiness', partOfSpeech: 'noun' }],
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_NOT_FOUND,
    );
  });

  it('rejects an archived deck', async () => {
    const { service } = setup({ decks: [makeDeck({ is_archived: true })] });
    await assert.rejects(
      () =>
        service.createWordFamily(USER_ID, DECK_ID, NOW, {
          baseWord: 'happy',
          derivatives: [{ form: 'happiness', partOfSpeech: 'noun' }],
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_UNAVAILABLE,
    );
  });

  it('rejects a derivative that already exists in the deck and creates nothing', async () => {
    const { world, service } = setup({
      flashcards: [
        makeFlashcard({
          type: FlashcardType.WORD_FORMATION,
          front: 'happy → noun',
          back: 'happiness',
          tags: ['family:happy'],
        }),
      ],
    });
    await assert.rejects(
      () =>
        service.createWordFamily(USER_ID, DECK_ID, NOW, {
          baseWord: 'happy',
          derivatives: [
            { form: 'happily', partOfSpeech: 'adverb' },
            { form: 'happiness', partOfSpeech: 'noun' },
          ],
        }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_DUPLICATE,
    );
    assert.equal(world.flashcards.length, 1);
  });
});

describe('FlashcardsService.listWordFamilies', () => {
  it('groups word-formation cards by their family tag', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({
          id: 'a',
          type: FlashcardType.WORD_FORMATION,
          front: 'happy → noun',
          back: 'happiness',
          tags: ['family:happy'],
        }),
        makeFlashcard({
          id: 'b',
          type: FlashcardType.WORD_FORMATION,
          front: 'happy → adverb',
          back: 'happily',
          tags: ['family:happy'],
        }),
        makeFlashcard({
          id: 'c',
          type: FlashcardType.WORD_FORMATION,
          front: 'decide → noun',
          back: 'decision',
          tags: ['family:decide'],
        }),
      ],
    });
    const families = await service.listWordFamilies(USER_ID, DECK_ID);
    assert.equal(families.length, 2);
    const happy = families.find((f) => f.familyTag === 'family:happy');
    assert.ok(happy);
    assert.equal(happy.baseWord, 'happy');
    assert.deepEqual(happy.derivatives.map((d) => d.id).sort(), ['a', 'b']);
  });

  it('ignores non-word-formation cards and word-formation cards without a family tag', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: 'a', type: FlashcardType.VOCABULARY, tags: ['family:happy'] }),
        makeFlashcard({ id: 'b', type: FlashcardType.WORD_FORMATION, tags: [] }),
      ],
    });
    const families = await service.listWordFamilies(USER_ID, DECK_ID);
    assert.deepEqual(families, []);
  });

  it('includes suspended word-formation cards', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({
          id: 'a',
          type: FlashcardType.WORD_FORMATION,
          status: FlashcardStatus.SUSPENDED,
          tags: ['family:happy'],
        }),
      ],
    });
    const families = await service.listWordFamilies(USER_ID, DECK_ID);
    assert.equal(families.length, 1);
  });

  it('rejects a deleted or foreign deck', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.listWordFamilies(OTHER_USER_ID, DECK_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_NOT_FOUND,
    );
  });
});

// ── Listar ───────────────────────────────────────────────────────────────────────

describe('FlashcardsService.listFlashcards', () => {
  it('lists active (non-suspended) cards by default', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: 'a', status: FlashcardStatus.NEW }),
        makeFlashcard({ id: 'b', status: FlashcardStatus.SUSPENDED }),
      ],
    });
    const result = await service.listFlashcards(USER_ID, DECK_ID, 'active');
    assert.deepEqual(
      result.map((c) => c.id),
      ['a'],
    );
  });

  it('lists suspended cards', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: 'a', status: FlashcardStatus.NEW }),
        makeFlashcard({ id: 'b', status: FlashcardStatus.SUSPENDED }),
      ],
    });
    const result = await service.listFlashcards(USER_ID, DECK_ID, 'suspended');
    assert.deepEqual(
      result.map((c) => c.id),
      ['b'],
    );
  });

  it('lists all non-deleted cards', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: 'a', status: FlashcardStatus.NEW }),
        makeFlashcard({ id: 'b', status: FlashcardStatus.SUSPENDED }),
      ],
    });
    const result = await service.listFlashcards(USER_ID, DECK_ID, 'all');
    assert.deepEqual(result.map((c) => c.id).sort(), ['a', 'b']);
  });

  it('filters by type', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: 'a', type: FlashcardType.GRAMMAR }),
        makeFlashcard({ id: 'b', type: FlashcardType.VOCABULARY }),
      ],
    });
    const result = await service.listFlashcards(USER_ID, DECK_ID, 'all', FlashcardType.GRAMMAR);
    assert.deepEqual(
      result.map((c) => c.id),
      ['a'],
    );
  });

  it('can list flashcards of an archived deck', async () => {
    const { service } = setup({
      decks: [makeDeck({ is_archived: true })],
      flashcards: [makeFlashcard()],
    });
    const result = await service.listFlashcards(USER_ID, DECK_ID, 'active');
    assert.equal(result.length, 1);
  });

  it('rejects a deleted or foreign deck', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.listFlashcards(OTHER_USER_ID, DECK_ID, 'active'),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.DECK_NOT_FOUND,
    );
  });

  it('returns DTOs without internal fields', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    const [card] = await service.listFlashcards(USER_ID, DECK_ID, 'all');
    assert.deepEqual(Object.keys(card).sort(), [
      'back',
      'createdAt',
      'deckId',
      'easeFactor',
      'example',
      'front',
      'id',
      'intervalMinutes',
      'lapses',
      'level',
      'nextReviewAt',
      'notes',
      'personalExample',
      'repetitions',
      'sourceName',
      'sourceUrl',
      'status',
      'tags',
      'translation',
      'type',
      'updatedAt',
    ]);
  });

  it('orders by created_at DESC then id ASC', async () => {
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-01-02T00:00:00.000Z');
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: 'z', created_at: older }),
        makeFlashcard({ id: 'a', created_at: older }),
        makeFlashcard({ id: 'm', created_at: newer }),
      ],
    });
    const result = await service.listFlashcards(USER_ID, DECK_ID, 'all');
    assert.deepEqual(
      result.map((c) => c.id),
      ['m', 'a', 'z'],
    );
  });
});

// ── Obtener ──────────────────────────────────────────────────────────────────────

describe('FlashcardsService.getFlashcard', () => {
  it('gets an active flashcard', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    const card = await service.getFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.id, FLASHCARD_ID);
  });

  it('gets a suspended flashcard', async () => {
    const { service } = setup({
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED })],
    });
    const card = await service.getFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.SUSPENDED);
  });

  it('gets a flashcard belonging to an archived deck', async () => {
    const { service } = setup({
      decks: [makeDeck({ is_archived: true })],
      flashcards: [makeFlashcard()],
    });
    const card = await service.getFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.id, FLASHCARD_ID);
  });

  it("does not find another user's flashcard", async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    await assert.rejects(
      () => service.getFlashcard(OTHER_USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('does not find a soft-deleted flashcard', async () => {
    const { service } = setup({ flashcards: [makeFlashcard({ deleted_at: NOW })] });
    await assert.rejects(
      () => service.getFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('does not find a flashcard whose deck was soft-deleted', async () => {
    const { service } = setup({
      decks: [makeDeck({ deleted_at: NOW })],
      flashcards: [makeFlashcard()],
    });
    await assert.rejects(
      () => service.getFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });
});

// ── Actualizar ───────────────────────────────────────────────────────────────────

describe('FlashcardsService.updateFlashcard', () => {
  it('updates each allowed field', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    const card = await service.updateFlashcard(USER_ID, FLASHCARD_ID, {
      front: 'New front',
      back: 'New back',
      translation: 'nueva',
      example: 'ex',
      personalExample: 'pex',
      notes: 'notes',
      sourceName: 'src',
      sourceUrl: 'https://example.com',
      level: 'B2' as never,
      tags: ['a', 'b'],
    });
    assert.equal(card.front, 'New front');
    assert.equal(card.back, 'New back');
    assert.equal(card.translation, 'nueva');
    assert.equal(card.sourceUrl, 'https://example.com');
    assert.deepEqual(card.tags, ['a', 'b']);
  });

  it('does not alter scheduling', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ status: FlashcardStatus.REVIEW, repetitions: 3, interval_minutes: 120 }),
      ],
    });
    const card = await service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'Changed' });
    assert.equal(card.status, FlashcardStatus.REVIEW);
    assert.equal(card.repetitions, 3);
    assert.equal(card.intervalMinutes, 120);
  });

  it('can update a suspended flashcard', async () => {
    const { service } = setup({
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED })],
    });
    const card = await service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'Changed' });
    assert.equal(card.front, 'Changed');
    assert.equal(card.status, FlashcardStatus.SUSPENDED);
  });

  it('can update a flashcard in an archived deck', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ is_archived: true })],
      flashcards: [makeFlashcard()],
    });
    const card = await service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'Changed' });
    assert.equal(card.front, 'Changed');
    assert.equal(world.mutationCalls.updateContent, 1);
  });

  it('rejects updating a flashcard whose deck was soft-deleted, without touching the repository', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ deleted_at: NOW })],
      flashcards: [makeFlashcard()],
    });
    await assert.rejects(
      () => service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'Changed' }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
    assert.equal(world.mutationCalls.updateContent, 0);
    assert.equal(world.flashcards[0].front, 'Ubiquitous');
  });

  it('an empty patch fails', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    await assert.rejects(() => service.updateFlashcard(USER_ID, FLASHCARD_ID, {}), isInvalidInput);
  });

  it('excludes the flashcard itself from the duplicate check', async () => {
    const { service } = setup({ flashcards: [makeFlashcard({ front: 'Front', back: 'Back' })] });
    const card = await service.updateFlashcard(USER_ID, FLASHCARD_ID, { notes: 'just a note' });
    assert.equal(card.front, 'Front');
  });

  it('a real duplicate against another card fails', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ id: FLASHCARD_ID, front: 'Front', back: 'Back' }),
        makeFlashcard({ id: 'other-card', front: 'Existing', back: 'Card' }),
      ],
    });
    await assert.rejects(
      () => service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'existing', back: 'card' }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_DUPLICATE,
    );
  });

  it('translates a race-condition constraint violation into FLASHCARD_DUPLICATE', async () => {
    const { service } = setup({
      flashcards: [makeFlashcard()],
      queuedUpdateError: DEDUPE_VIOLATION,
    });
    await assert.rejects(
      () => service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'Changed' }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_DUPLICATE,
    );
  });

  it('affected === 0 produces FLASHCARD_NOT_FOUND', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    await assert.rejects(
      () => service.updateFlashcard(OTHER_USER_ID, FLASHCARD_ID, { front: 'Changed' }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('rejects updating a soft-deleted flashcard', async () => {
    const { service } = setup({ flashcards: [makeFlashcard({ deleted_at: NOW })] });
    await assert.rejects(
      () => service.updateFlashcard(USER_ID, FLASHCARD_ID, { front: 'Changed' }),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('never lets deckId/userId/status be modified through update', async () => {
    const { world, service } = setup({ flashcards: [makeFlashcard()] });
    const maliciousInput = {
      front: 'Changed',
      deckId: 'someone-elses-deck',
      userId: OTHER_USER_ID,
      status: FlashcardStatus.SUSPENDED,
    } as unknown as { front: string };
    await service.updateFlashcard(USER_ID, FLASHCARD_ID, maliciousInput);
    assert.equal(world.flashcards[0].deck_id, DECK_ID);
    assert.equal(world.flashcards[0].user_id, USER_ID);
    assert.equal(world.flashcards[0].status, FlashcardStatus.NEW);
  });
});

// ── Suspender ────────────────────────────────────────────────────────────────────

describe('FlashcardsService.suspendFlashcard', () => {
  for (const status of [FlashcardStatus.NEW, FlashcardStatus.LEARNING, FlashcardStatus.REVIEW]) {
    it(`suspends a ${status} flashcard`, async () => {
      const { service } = setup({ flashcards: [makeFlashcard({ status })] });
      const card = await service.suspendFlashcard(USER_ID, FLASHCARD_ID);
      assert.equal(card.status, FlashcardStatus.SUSPENDED);
    });
  }

  it('is idempotent when already suspended', async () => {
    const { service } = setup({
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED })],
    });
    const first = await service.suspendFlashcard(USER_ID, FLASHCARD_ID);
    const second = await service.suspendFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(first.status, FlashcardStatus.SUSPENDED);
    assert.equal(second.status, FlashcardStatus.SUSPENDED);
  });

  it('does not modify scheduling', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ status: FlashcardStatus.REVIEW, repetitions: 5, interval_minutes: 200 }),
      ],
    });
    const card = await service.suspendFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.repetitions, 5);
    assert.equal(card.intervalMinutes, 200);
  });

  it("does not affect another user's flashcard", async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    await assert.rejects(
      () => service.suspendFlashcard(OTHER_USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('does not affect a soft-deleted flashcard', async () => {
    const { service } = setup({ flashcards: [makeFlashcard({ deleted_at: NOW })] });
    await assert.rejects(
      () => service.suspendFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('can suspend a flashcard in an archived deck', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ is_archived: true })],
      flashcards: [makeFlashcard({ status: FlashcardStatus.NEW })],
    });
    const card = await service.suspendFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.SUSPENDED);
    assert.equal(world.mutationCalls.suspendFlashcard, 1);
  });

  it('rejects suspending a flashcard whose deck was soft-deleted, without touching the repository', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ deleted_at: NOW })],
      flashcards: [makeFlashcard({ status: FlashcardStatus.NEW })],
    });
    await assert.rejects(
      () => service.suspendFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
    assert.equal(world.mutationCalls.suspendFlashcard, 0);
    assert.equal(world.flashcards[0].status, FlashcardStatus.NEW);
  });
});

// ── Reactivar ────────────────────────────────────────────────────────────────────

describe('FlashcardsService.reactivateFlashcard', () => {
  it('suspended with no progress becomes new', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ status: FlashcardStatus.SUSPENDED, repetitions: 0, interval_minutes: 0 }),
      ],
    });
    const card = await service.reactivateFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.NEW);
  });

  it('suspended with progress (repetitions > 0) becomes review', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ status: FlashcardStatus.SUSPENDED, repetitions: 2, interval_minutes: 0 }),
      ],
    });
    const card = await service.reactivateFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.REVIEW);
  });

  it('suspended with progress (interval_minutes > 0) becomes review', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ status: FlashcardStatus.SUSPENDED, repetitions: 0, interval_minutes: 60 }),
      ],
    });
    const card = await service.reactivateFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.REVIEW);
  });

  it('an already-active flashcard is left untouched (never downgraded)', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({ status: FlashcardStatus.REVIEW, repetitions: 5, interval_minutes: 500 }),
      ],
    });
    const card = await service.reactivateFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.REVIEW);
  });

  it('does not modify scheduling', async () => {
    const { service } = setup({
      flashcards: [
        makeFlashcard({
          status: FlashcardStatus.SUSPENDED,
          repetitions: 4,
          interval_minutes: 300,
          next_review_at: NOW,
        }),
      ],
    });
    const card = await service.reactivateFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.repetitions, 4);
    assert.equal(card.intervalMinutes, 300);
    assert.deepEqual(card.nextReviewAt, NOW);
  });

  it("does not affect another user's flashcard", async () => {
    const { service } = setup({
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED })],
    });
    await assert.rejects(
      () => service.reactivateFlashcard(OTHER_USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('does not affect a soft-deleted flashcard', async () => {
    const { service } = setup({
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED, deleted_at: NOW })],
    });
    await assert.rejects(
      () => service.reactivateFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('can reactivate a flashcard in an archived deck', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ is_archived: true })],
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED })],
    });
    const card = await service.reactivateFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(card.status, FlashcardStatus.NEW);
    assert.equal(world.mutationCalls.reactivateFlashcard, 1);
  });

  it('rejects reactivating a flashcard whose deck was soft-deleted, without touching the repository', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ deleted_at: NOW })],
      flashcards: [makeFlashcard({ status: FlashcardStatus.SUSPENDED })],
    });
    await assert.rejects(
      () => service.reactivateFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
    assert.equal(world.mutationCalls.reactivateFlashcard, 0);
    assert.equal(world.flashcards[0].status, FlashcardStatus.SUSPENDED);
  });
});

// ── Eliminar ─────────────────────────────────────────────────────────────────────

describe('FlashcardsService.deleteFlashcard', () => {
  it('soft-deletes the flashcard', async () => {
    const { world, service } = setup({ flashcards: [makeFlashcard()] });
    await service.deleteFlashcard(USER_ID, FLASHCARD_ID);
    assert.notEqual(world.flashcards[0].deleted_at, null);
  });

  it('never hard-deletes the row', async () => {
    const { world, service } = setup({ flashcards: [makeFlashcard()] });
    await service.deleteFlashcard(USER_ID, FLASHCARD_ID);
    assert.equal(world.flashcards.length, 1);
  });

  it('affected === 0 produces FLASHCARD_NOT_FOUND', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    await assert.rejects(
      () => service.deleteFlashcard(OTHER_USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it('a second delete attempt returns FLASHCARD_NOT_FOUND', async () => {
    const { service } = setup({ flashcards: [makeFlashcard()] });
    await service.deleteFlashcard(USER_ID, FLASHCARD_ID);
    await assert.rejects(
      () => service.deleteFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
  });

  it("does not affect another user's flashcard", async () => {
    const { world, service } = setup({ flashcards: [makeFlashcard()] });
    await assert.rejects(
      () => service.deleteFlashcard(OTHER_USER_ID, FLASHCARD_ID),
      () => true,
    );
    assert.equal(world.flashcards[0].deleted_at, null);
  });

  it('can delete a flashcard in an archived deck', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ is_archived: true })],
      flashcards: [makeFlashcard()],
    });
    await service.deleteFlashcard(USER_ID, FLASHCARD_ID);
    assert.notEqual(world.flashcards[0].deleted_at, null);
    assert.equal(world.mutationCalls.softDeleteFlashcard, 1);
  });

  it('rejects deleting a flashcard whose deck was soft-deleted, without touching the repository', async () => {
    const { world, service } = setup({
      decks: [makeDeck({ deleted_at: NOW })],
      flashcards: [makeFlashcard()],
    });
    await assert.rejects(
      () => service.deleteFlashcard(USER_ID, FLASHCARD_ID),
      (error: unknown) =>
        error instanceof FlashcardError && error.code === FlashcardErrorCode.FLASHCARD_NOT_FOUND,
    );
    assert.equal(world.mutationCalls.softDeleteFlashcard, 0);
    assert.equal(world.flashcards[0].deleted_at, null);
  });
});
