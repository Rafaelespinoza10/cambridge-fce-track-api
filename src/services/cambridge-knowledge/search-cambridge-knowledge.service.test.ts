import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  SearchCambridgeKnowledgeService,
  SearchCambridgeKnowledgeError,
  SearchCambridgeKnowledgeErrorCode,
} from './search-cambridge-knowledge.service';
import type {
  CambridgeKnowledgeItemsRepositoryPort,
  SearchCambridgeKnowledgeServiceDeps,
} from './search-cambridge-knowledge.service';
import type { EmbeddingClient } from './embed-cambridge-chunks';
import type { KnowledgeItemSearchCandidate } from '../../repositories/cambridge-knowledge-items.repository';

const FAKE_DATA_SOURCE = {} as DataSource;

function candidate(
  overrides: Partial<KnowledgeItemSearchCandidate> = {},
): KnowledgeItemSearchCandidate {
  return {
    id: 'item-1',
    content: 'Some chunk content.',
    sourceName: 'B2 First Handbook',
    sourcePage: 1,
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    skills: ['use-of-english'],
    topics: ['travel and tourism'],
    embedding: [1, 0, 0],
    ...overrides,
  };
}

function makeService(
  candidates: KnowledgeItemSearchCandidate[],
  embed: (texts: string[]) => Promise<number[][]>,
): {
  service: SearchCambridgeKnowledgeService;
  searchCalls: Parameters<CambridgeKnowledgeItemsRepositoryPort['search']>[0][];
} {
  const searchCalls: Parameters<CambridgeKnowledgeItemsRepositoryPort['search']>[0][] = [];
  const items = (): CambridgeKnowledgeItemsRepositoryPort => ({
    search: async (filters) => {
      searchCalls.push(filters);
      return candidates;
    },
  });
  const embeddingClient: EmbeddingClient = { defaultModel: 'fake', embed };
  const deps: SearchCambridgeKnowledgeServiceDeps = { embeddingClient, items };
  return { service: new SearchCambridgeKnowledgeService(FAKE_DATA_SOURCE, deps), searchCalls };
}

describe('SearchCambridgeKnowledgeService', () => {
  it('ranks results by cosine similarity to the query embedding, most relevant first', async () => {
    const candidates = [
      candidate({ id: 'far', content: 'far match', embedding: [0, 1, 0] }),
      candidate({ id: 'exact', content: 'exact match', embedding: [1, 0, 0] }),
      candidate({ id: 'partial', content: 'partial match', embedding: [0.7, 0.7, 0] }),
    ];
    const { service } = makeService(candidates, async () => [[1, 0, 0]]);

    const results = await service.execute({ query: 'use of english cloze' });

    assert.deepEqual(
      results.map((r) => r.content),
      ['exact match', 'partial match', 'far match'],
    );
    assert.ok(results[0].relevanceScore > results[1].relevanceScore);
    assert.ok(results[1].relevanceScore > results[2].relevanceScore);
  });

  it('passes paperCode/partCode/skill/topic filters straight through to the repository', async () => {
    const { service, searchCalls } = makeService([], async () => [[1, 0, 0]]);

    await service.execute({
      query: 'grammar',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_2',
      skill: 'use-of-english',
      topic: 'travel and tourism',
    });

    assert.deepEqual(searchCalls[0], {
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_2',
      skill: 'use-of-english',
      topic: 'travel and tourism',
    });
  });

  it('never includes the embedding vector in a result', async () => {
    const { service } = makeService([candidate()], async () => [[1, 0, 0]]);

    const results = await service.execute({ query: 'anything' });

    assert.ok(!('embedding' in results[0]));
    assert.deepEqual(Object.keys(results[0]).sort(), [
      'content',
      'paperCode',
      'partCode',
      'relevanceScore',
      'skills',
      'sourceName',
      'sourcePage',
      'topics',
    ]);
  });

  it('enforces the result limit after ranking, not before', async () => {
    const candidates = [
      candidate({ id: 'a', embedding: [1, 0, 0] }),
      candidate({ id: 'b', embedding: [0.9, 0.1, 0] }),
      candidate({ id: 'c', embedding: [0, 1, 0] }),
    ];
    const { service } = makeService(candidates, async () => [[1, 0, 0]]);

    const results = await service.execute({ query: 'x', limit: 2 });

    assert.equal(results.length, 2);
    // The 2 kept are the most relevant ones, not just the first 2 candidates.
    assert.ok(results.every((r) => r.relevanceScore >= 0.5));
  });

  it('rejects a limit outside [1, 50]', async () => {
    const { service } = makeService([], async () => [[1, 0, 0]]);

    await assert.rejects(
      () => service.execute({ limit: 0 }),
      (err: unknown) =>
        err instanceof SearchCambridgeKnowledgeError &&
        err.code === SearchCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
    await assert.rejects(
      () => service.execute({ limit: 51 }),
      (err: unknown) =>
        err instanceof SearchCambridgeKnowledgeError &&
        err.code === SearchCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
  });

  it('rejects a blank query string rather than silently treating it as "no query"', async () => {
    const { service } = makeService([], async () => [[1, 0, 0]]);

    await assert.rejects(
      () => service.execute({ query: '   ' }),
      (err: unknown) =>
        err instanceof SearchCambridgeKnowledgeError &&
        err.code === SearchCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
  });

  it('without a query, still returns metadata-filtered results (deterministically ordered), without calling the embedding provider', async () => {
    let embedCalled = false;
    const candidates = [candidate({ id: 'a' }), candidate({ id: 'b' })];
    const { service } = makeService(candidates, async () => {
      embedCalled = true;
      return [[1, 0, 0]];
    });

    const results = await service.execute({ paperCode: 'PAPER_1' });

    assert.equal(embedCalled, false);
    assert.equal(results.length, 2);
    for (const result of results) assert.equal(result.relevanceScore, 0);
  });

  it('applies the default limit (10) when none is given', async () => {
    const candidates = Array.from({ length: 15 }, (_, i) =>
      candidate({ id: `item-${i}`, embedding: [1, 0, 0] }),
    );
    const { service } = makeService(candidates, async () => [[1, 0, 0]]);

    const results = await service.execute({ query: 'x' });

    assert.equal(results.length, 10);
  });
});
