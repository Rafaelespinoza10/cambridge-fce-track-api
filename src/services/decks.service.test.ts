import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, UpdateResult } from 'typeorm';

import { DecksService, DeckError, DeckErrorCode } from './decks.service';
import type { DecksRepositoryPort, DecksServiceDeps } from './decks.service';
import type { Deck } from '../models/Deck';
import type { CreateDeckData, UpdateDeckData } from '../repositories/decks.repository';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const DECK_ID = 'deck-1';
const NOW = new Date('2026-01-15T00:00:00.000Z');

const OK_RESULT: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
const NO_MATCH_RESULT: UpdateResult = { affected: 0, raw: [], generatedMaps: [] };

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

interface World {
  decks: Deck[];
}

function createWorld(overrides: Partial<World> = {}): World {
  return { decks: [makeDeck()], ...overrides };
}

let idCounter = 0;

function buildFakeRepo(world: World): DecksRepositoryPort {
  return {
    createDeck: async (data: CreateDeckData) => {
      idCounter += 1;
      const deck = makeDeck({
        id: `created-${idCounter}`,
        user_id: data.userId,
        name: data.name,
        description: data.description,
        color: data.color,
      });
      world.decks.push(deck);
      return deck;
    },
    findNonDeletedByIdAndUser: async (deckId, userId) => {
      const found = world.decks.find(
        (d) => d.id === deckId && d.user_id === userId && d.deleted_at === null,
      );
      return found ?? null;
    },
    findAvailableByUser: async (userId) =>
      world.decks.filter((d) => d.user_id === userId && d.deleted_at === null && !d.is_archived),
    findArchivedByUser: async (userId) =>
      world.decks.filter((d) => d.user_id === userId && d.deleted_at === null && d.is_archived),
    updateDeck: async (deckId, userId, data: UpdateDeckData) => {
      const deck = world.decks.find(
        (d) => d.id === deckId && d.user_id === userId && d.deleted_at === null,
      );
      if (deck === undefined) return NO_MATCH_RESULT;
      Object.assign(deck, data, { updated_at: new Date() });
      return OK_RESULT;
    },
    archiveDeck: async (deckId, userId) => {
      const deck = world.decks.find(
        (d) => d.id === deckId && d.user_id === userId && d.deleted_at === null,
      );
      if (deck === undefined) return NO_MATCH_RESULT;
      deck.is_archived = true;
      return OK_RESULT;
    },
    unarchiveDeck: async (deckId, userId) => {
      const deck = world.decks.find(
        (d) => d.id === deckId && d.user_id === userId && d.deleted_at === null,
      );
      if (deck === undefined) return NO_MATCH_RESULT;
      deck.is_archived = false;
      return OK_RESULT;
    },
    softDeleteDeck: async (deckId, userId) => {
      const deck = world.decks.find(
        (d) => d.id === deckId && d.user_id === userId && d.deleted_at === null,
      );
      if (deck === undefined) return NO_MATCH_RESULT;
      deck.deleted_at = new Date();
      return OK_RESULT;
    },
  };
}

function setup(worldOverrides: Partial<World> = {}) {
  const world = createWorld(worldOverrides);
  const repo = buildFakeRepo(world);
  const deps: DecksServiceDeps = { decks: () => repo };
  const service = new DecksService({} as DataSource, deps);
  return { world, repo, service };
}

// ── Crear ────────────────────────────────────────────────────────────────────────

describe('DecksService.createDeck', () => {
  it('creates a deck with the expected defaults', async () => {
    const { service } = setup();
    const deck = await service.createDeck(USER_ID, { name: 'Idioms' });
    assert.equal(deck.name, 'Idioms');
    assert.equal(deck.isArchived, false);
    assert.equal(deck.description, null);
    assert.equal(deck.color, null);
  });

  it('normalizes (trims) the name', async () => {
    const { service } = setup();
    const deck = await service.createDeck(USER_ID, { name: '  Idioms  ' });
    assert.equal(deck.name, 'Idioms');
  });

  it('normalizes color to uppercase', async () => {
    const { service } = setup();
    const deck = await service.createDeck(USER_ID, { name: 'Idioms', color: '#ff00aa' });
    assert.equal(deck.color, '#FF00AA');
  });

  it('an empty description becomes null', async () => {
    const { service } = setup();
    const deck = await service.createDeck(USER_ID, { name: 'Idioms', description: '   ' });
    assert.equal(deck.description, null);
  });

  it('rejects an empty name', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createDeck(USER_ID, { name: '   ' }),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.INVALID_INPUT,
    );
  });

  it('rejects a name over 255 characters', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createDeck(USER_ID, { name: 'a'.repeat(256) }),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.INVALID_INPUT,
    );
  });

  it('rejects an invalid color', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createDeck(USER_ID, { name: 'Idioms', color: 'blue' }),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.INVALID_INPUT,
    );
  });

  it('never lets an externally-supplied userId override the authenticated one', async () => {
    const { world, service } = setup();
    const maliciousInput = { name: 'Idioms', userId: OTHER_USER_ID } as unknown as { name: string };
    await service.createDeck(USER_ID, maliciousInput);
    const created = world.decks.find((d) => d.name === 'Idioms');
    assert.equal(created?.user_id, USER_ID);
  });
});

// ── Listar ───────────────────────────────────────────────────────────────────────

describe('DecksService.listDecks', () => {
  it('lists available decks', async () => {
    const { service } = setup({
      decks: [makeDeck({ id: 'a', is_archived: false }), makeDeck({ id: 'b', is_archived: true })],
    });
    const result = await service.listDecks(USER_ID, 'available');
    assert.deepEqual(
      result.map((d) => d.id),
      ['a'],
    );
  });

  it('lists archived decks', async () => {
    const { service } = setup({
      decks: [makeDeck({ id: 'a', is_archived: false }), makeDeck({ id: 'b', is_archived: true })],
    });
    const result = await service.listDecks(USER_ID, 'archived');
    assert.deepEqual(
      result.map((d) => d.id),
      ['b'],
    );
  });

  it('returns DTOs without internal fields', async () => {
    const { service } = setup();
    const [deck] = await service.listDecks(USER_ID, 'available');
    assert.deepEqual(Object.keys(deck).sort(), [
      'color',
      'createdAt',
      'description',
      'id',
      'isArchived',
      'name',
      'updatedAt',
    ]);
  });
});

// ── Obtener ──────────────────────────────────────────────────────────────────────

describe('DecksService.getDeck', () => {
  it('returns the caller-owned deck', async () => {
    const { service } = setup();
    const deck = await service.getDeck(USER_ID, DECK_ID);
    assert.equal(deck.id, DECK_ID);
  });

  it('does not find a deck belonging to another user', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.getDeck(OTHER_USER_ID, DECK_ID),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });

  it('does not find a soft-deleted deck', async () => {
    const { service } = setup({ decks: [makeDeck({ deleted_at: NOW })] });
    await assert.rejects(
      () => service.getDeck(USER_ID, DECK_ID),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });

  it('can retrieve an archived deck', async () => {
    const { service } = setup({ decks: [makeDeck({ is_archived: true })] });
    const deck = await service.getDeck(USER_ID, DECK_ID);
    assert.equal(deck.isArchived, true);
  });
});

// ── Actualizar ───────────────────────────────────────────────────────────────────

describe('DecksService.updateDeck', () => {
  it('updates the allowed fields', async () => {
    const { service } = setup();
    const deck = await service.updateDeck(USER_ID, DECK_ID, { name: 'New name' });
    assert.equal(deck.name, 'New name');
  });

  it('never lets isArchived be modified through update', async () => {
    const { world, service } = setup();
    const maliciousInput = { name: 'New name', isArchived: true } as unknown as { name: string };
    await service.updateDeck(USER_ID, DECK_ID, maliciousInput);
    assert.equal(world.decks[0].is_archived, false);
  });

  it('never lets ownership be modified through update', async () => {
    const { world, service } = setup();
    const maliciousInput = { name: 'New name', userId: OTHER_USER_ID } as unknown as {
      name: string;
    };
    await service.updateDeck(USER_ID, DECK_ID, maliciousInput);
    assert.equal(world.decks[0].user_id, USER_ID);
  });

  it('affected === 0 produces DECK_NOT_FOUND', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updateDeck(OTHER_USER_ID, DECK_ID, { name: 'New name' }),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });

  it('can update an archived deck', async () => {
    const { service } = setup({ decks: [makeDeck({ is_archived: true })] });
    const deck = await service.updateDeck(USER_ID, DECK_ID, { name: 'New name' });
    assert.equal(deck.name, 'New name');
    assert.equal(deck.isArchived, true);
  });

  it('an empty patch fails', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.updateDeck(USER_ID, DECK_ID, {}),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.INVALID_INPUT,
    );
  });

  it('an explicit null clears description/color', async () => {
    const { service } = setup({ decks: [makeDeck({ description: 'old', color: '#AABBCC' })] });
    const deck = await service.updateDeck(USER_ID, DECK_ID, { description: null, color: null });
    assert.equal(deck.description, null);
    assert.equal(deck.color, null);
  });
});

// ── Archivar / desarchivar ─────────────────────────────────────────────────────────

describe('DecksService.archiveDeck / unarchiveDeck', () => {
  it('archives an available deck', async () => {
    const { service } = setup();
    const deck = await service.archiveDeck(USER_ID, DECK_ID);
    assert.equal(deck.isArchived, true);
  });

  it('unarchives an archived deck', async () => {
    const { service } = setup({ decks: [makeDeck({ is_archived: true })] });
    const deck = await service.unarchiveDeck(USER_ID, DECK_ID);
    assert.equal(deck.isArchived, false);
  });

  it('archiving twice is idempotent', async () => {
    const { service } = setup();
    const first = await service.archiveDeck(USER_ID, DECK_ID);
    const second = await service.archiveDeck(USER_ID, DECK_ID);
    assert.equal(first.isArchived, true);
    assert.equal(second.isArchived, true);
  });

  it('unarchiving twice is idempotent', async () => {
    const { service } = setup();
    const first = await service.unarchiveDeck(USER_ID, DECK_ID);
    const second = await service.unarchiveDeck(USER_ID, DECK_ID);
    assert.equal(first.isArchived, false);
    assert.equal(second.isArchived, false);
  });

  it("does not affect another user's deck", async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.archiveDeck(OTHER_USER_ID, DECK_ID),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });

  it('does not affect a soft-deleted deck', async () => {
    const { service } = setup({ decks: [makeDeck({ deleted_at: NOW })] });
    await assert.rejects(
      () => service.archiveDeck(USER_ID, DECK_ID),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });
});

// ── Eliminar ─────────────────────────────────────────────────────────────────────

describe('DecksService.deleteDeck', () => {
  it('soft-deletes the deck', async () => {
    const { world, service } = setup();
    await service.deleteDeck(USER_ID, DECK_ID);
    assert.notEqual(world.decks[0].deleted_at, null);
  });

  it('affected === 0 produces DECK_NOT_FOUND', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.deleteDeck(OTHER_USER_ID, DECK_ID),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });

  it('never hard-deletes the row', async () => {
    const { world, service } = setup();
    await service.deleteDeck(USER_ID, DECK_ID);
    assert.equal(world.decks.length, 1);
  });

  it('a second delete attempt returns DECK_NOT_FOUND', async () => {
    const { service } = setup();
    await service.deleteDeck(USER_ID, DECK_ID);
    await assert.rejects(
      () => service.deleteDeck(USER_ID, DECK_ID),
      (error: unknown) => error instanceof DeckError && error.code === DeckErrorCode.DECK_NOT_FOUND,
    );
  });
});
