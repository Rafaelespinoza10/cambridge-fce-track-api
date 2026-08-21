import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import { ImportCambridgeKnowledgeService } from './import-cambridge-knowledge.service';
import type {
  CambridgeSourcesRepositoryPort,
  CambridgeKnowledgeItemsRepositoryPort,
} from './import-cambridge-knowledge.service';
import { SearchCambridgeKnowledgeService } from './search-cambridge-knowledge.service';
import type { CambridgeKnowledgeItemsRepositoryPort as SearchItemsRepositoryPort } from './search-cambridge-knowledge.service';
import type { CambridgeChunkClassifier } from './classify-cambridge-chunk';
import type { EmbeddingClient } from './embed-cambridge-chunks';
import type { CreateSourceData } from '@repositories/cambridge-knowledge/cambridge-sources.repository';
import type {
  CreateKnowledgeItemData,
  KnowledgeItemSearchCandidate,
} from '@repositories/cambridge-knowledge/cambridge-knowledge-items.repository';
import type { CambridgeSource } from '../../models/CambridgeSource';
import { CambridgeSourceStatus } from '../../models/enums';
import { extractPdf } from '@lib/cambridge-knowledge/cambridge-pdf-extractor';
import { buildTestPdf } from '../../test-fixtures/build-test-pdf';

/**
 * "Validación real" — the one place in this PR that runs the REAL PDF
 * extraction -> cleaning -> chunking -> cosine-similarity-search pipeline
 * against a real (locally built) multi-page PDF end to end, not just each
 * stage in isolation. Only the two AI provider calls (classification,
 * embeddings) are faked — no OPEN_AI_API_KEY is available in CI/local test
 * runs, and this file's job is to validate the PIPELINE, not the AI
 * provider integration (that's classify-cambridge-chunk.test.ts and
 * embed-cambridge-chunks.test.ts). Persistence uses simple in-memory arrays
 * (no DB in this environment) rather than the rollback-simulating fake in
 * import-cambridge-knowledge.service.test.ts — this file isn't testing
 * transactionality, it's testing the real content pipeline.
 *
 * Only ONE real PDF buffer is built and parsed in this file — see the
 * flakiness note on cambridge-pdf-extractor.test.ts for why.
 */

const SAMPLE_PAPER_PAGES = [
  [
    'Cambridge English: First for Schools — Sample Paper',
    'READING AND USE OF ENGLISH',
    'Part 1',
    'For questions 1-3, read the text below and decide which answer',
    '(A, B, C or D) best fits each gap.',
    '1. A) look B) see C) watch D) view',
    '2. A) big B) large C) huge D) great',
    'Page 1',
  ].join('\n'),
  [
    'Cambridge English: First for Schools — Sample Paper',
    'READING AND USE OF ENGLISH',
    'Part 3',
    'For questions 9-16, read the text below. Use the word given in',
    'capitals to form a word that fits in the gap.',
    '9. The scientists made an important DISCOVER _____.',
    '10. Her ARGUE _____ was very convincing.',
    'Page 2',
  ].join('\n'),
  [
    'Cambridge English: First for Schools — Sample Paper',
    'WRITING',
    'Part 1',
    'You must answer this question. Write an essay using all the notes',
    'and give reasons for your point of view.',
    'Some people say that social media has changed the way young',
    'people communicate. To what extent do you agree?',
    'Page 3',
  ].join('\n'),
];

// A tiny, transparent "embedding": one dimension per keyword, 1 if the
// keyword appears in the text, 0 otherwise. Not remotely a real embedding
// model, but it gives cosine similarity a real, verifiable signal to rank
// on — proving the ranking math works against actual page content, not
// just against opaque random vectors.
const KEYWORDS = ['cloze', 'word', 'formation', 'essay', 'social', 'media', 'writing', 'reading'];
function keywordEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  return KEYWORDS.map((k) => (lower.includes(k) ? 1 : 0));
}

function fakeClassifier(): CambridgeChunkClassifier {
  return {
    classify: async (content) => {
      if (content.includes('Part 1') && content.includes('READING'))
        return {
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_1',
          skills: ['use-of-english'],
          topics: [],
        };
      if (content.includes('Part 3'))
        return {
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_3',
          skills: ['use-of-english'],
          topics: [],
        };
      if (content.includes('WRITING'))
        return {
          paperCode: 'PAPER_2',
          partCode: 'WRITING_PART_1',
          skills: ['writing'],
          topics: ['social media and online communication'],
        };
      return { paperCode: null, partCode: null, skills: [], topics: [] };
    },
  };
}

function fakeEmbeddingClient(): EmbeddingClient {
  return {
    defaultModel: 'fake-keyword-embedding',
    embed: async (texts) => texts.map(keywordEmbedding),
  };
}

// ── Simple in-memory persistence (not rollback-simulating — see file doc comment) ──

function makeInMemoryStore() {
  const sources: CambridgeSource[] = [];
  const items: (CreateKnowledgeItemData & { id: string })[] = [];
  let itemIdCounter = 0;

  const dataSource = {
    transaction: async <T>(work: (manager: unknown) => Promise<T>) => work({}),
  } as unknown as DataSource;

  const sourcesFactory = (): CambridgeSourcesRepositoryPort => ({
    findByChecksum: async (checksum) => sources.find((s) => s.checksum === checksum) ?? null,
    createSource: async (data: CreateSourceData) => {
      const created: CambridgeSource = {
        id: `source-${sources.length + 1}`,
        name: data.name,
        description: data.description,
        version: data.version,
        status: CambridgeSourceStatus.ACTIVE,
        checksum: data.checksum,
        page_count: data.pageCount,
        created_at: new Date(),
        updated_at: new Date(),
      } as CambridgeSource;
      sources.push(created);
      return created;
    },
    listSources: async () => [],
  });

  const itemsFactory = (): CambridgeKnowledgeItemsRepositoryPort => ({
    bulkInsert: async (data) => {
      for (const item of data) {
        itemIdCounter += 1;
        items.push({ ...item, id: `item-${itemIdCounter}` });
      }
      return data.length;
    },
  });

  const searchItemsFactory = (): SearchItemsRepositoryPort => ({
    search: async (filters): Promise<KnowledgeItemSearchCandidate[]> => {
      const activeSourceIds = new Set(
        sources.filter((s) => s.status === CambridgeSourceStatus.ACTIVE).map((s) => s.id),
      );
      return items
        .filter((item) => activeSourceIds.has(item.sourceId))
        .filter((item) => filters.paperCode === undefined || item.paperCode === filters.paperCode)
        .filter((item) => filters.partCode === undefined || item.partCode === filters.partCode)
        .filter((item) => filters.skill === undefined || item.skills.includes(filters.skill))
        .filter((item) => filters.topic === undefined || item.topics.includes(filters.topic))
        .map((item) => {
          const source = sources.find((s) => s.id === item.sourceId)!;
          return {
            id: item.id,
            content: item.content,
            sourceName: source.name,
            sourcePage: item.sourcePage,
            paperCode: item.paperCode,
            partCode: item.partCode,
            skills: item.skills,
            topics: item.topics,
            embedding: item.embedding,
          };
        });
    },
  });

  return { dataSource, sources, items, sourcesFactory, itemsFactory, searchItemsFactory };
}

describe('Cambridge Knowledge Base — real end-to-end validation (real PDF, real chunking, faked AI calls)', () => {
  it('imports a realistic multi-page paper, chunks it with correct traceability, is idempotent on re-import, and supports ranked + filtered search', async () => {
    const pdf = buildTestPdf(SAMPLE_PAPER_PAGES);

    // Sanity check on the fixture itself before running the pipeline.
    const rawExtraction = await extractPdf(pdf);
    assert.equal(rawExtraction.pageCount, 3);

    const store = makeInMemoryStore();
    const importService = new ImportCambridgeKnowledgeService(store.dataSource, {
      classifier: fakeClassifier(),
      embeddingClient: fakeEmbeddingClient(),
      sources: store.sourcesFactory,
      items: store.itemsFactory,
    });

    // ── 1. Import ──────────────────────────────────────────────────────────
    const firstImport = await importService.execute({
      name: 'B2 First for Schools — Sample Paper',
      description: 'Real end-to-end validation fixture',
      version: '2024-sample',
      file: pdf,
    });

    assert.equal(firstImport.idempotentReplay, false);
    assert.ok(firstImport.chunkCount >= 3, 'expected at least one chunk per page');
    assert.equal(store.sources.length, 1);

    // ── 2. Verify chunks — traceability to document + exact page ─────────
    const headerFreeItems = store.items;
    for (const item of headerFreeItems) {
      // Running header/footer ("Cambridge English:...", "Page N") were
      // stripped by the cleaning stage — never leak into a persisted chunk.
      assert.ok(!item.content.includes('Cambridge English: First for Schools'));
      assert.ok(!/^Page \d+$/m.test(item.content));
      assert.equal(item.sourceId, store.sources[0].id);
      assert.ok(item.sourcePage >= 1 && item.sourcePage <= 3);
    }
    // Real exercise content survived chunking (nothing lost to bad chunking/cleaning).
    assert.ok(headerFreeItems.some((i) => i.content.includes('DISCOVER')));
    assert.ok(headerFreeItems.some((i) => i.content.includes('social media')));
    assert.ok(
      headerFreeItems.some((i) => i.paperCode === 'PAPER_1' && i.partCode === 'UOE_PART_3'),
    );
    assert.ok(
      headerFreeItems.some((i) => i.paperCode === 'PAPER_2' && i.skills.includes('writing')),
    );

    // ── 3. Re-import the exact same PDF — idempotent, no duplicates ──────
    const secondImport = await importService.execute({
      name: 'B2 First for Schools — Sample Paper',
      description: 'Real end-to-end validation fixture',
      version: '2024-sample',
      file: pdf,
    });

    assert.equal(secondImport.idempotentReplay, true);
    assert.equal(secondImport.source.id, firstImport.source.id);
    assert.equal(store.sources.length, 1, 'no duplicate source row was created');
    assert.equal(store.items.length, headerFreeItems.length, 'no duplicate chunks were created');

    // ── 4. Semantic search — ranks the word-formation chunk highest for a word-formation query ──
    const searchService = new SearchCambridgeKnowledgeService(store.dataSource, {
      embeddingClient: fakeEmbeddingClient(),
      items: store.searchItemsFactory,
    });

    const wordFormationResults = await searchService.execute({ query: 'word formation exercise' });
    assert.ok(wordFormationResults.length > 0);
    assert.ok(wordFormationResults[0].content.includes('DISCOVER'));
    assert.ok(wordFormationResults[0].relevanceScore > 0);
    assert.ok(!('embedding' in wordFormationResults[0]));

    // ── 5. Metadata filter — only Writing-paper chunks come back ─────────
    const writingOnly = await searchService.execute({ paperCode: 'PAPER_2' });
    assert.ok(writingOnly.length > 0);
    for (const result of writingOnly) assert.equal(result.paperCode, 'PAPER_2');

    // ── 6. Inactive source — its chunks never surface in search ──────────
    store.sources[0].status = CambridgeSourceStatus.INACTIVE;
    const afterDeactivation = await searchService.execute({ paperCode: 'PAPER_1' });
    assert.equal(afterDeactivation.length, 0);
  });
});
