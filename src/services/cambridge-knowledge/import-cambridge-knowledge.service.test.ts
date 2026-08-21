import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  ImportCambridgeKnowledgeService,
  ImportCambridgeKnowledgeError,
  ImportCambridgeKnowledgeErrorCode,
} from './import-cambridge-knowledge.service';
import type {
  CambridgeSourcesRepositoryPort,
  CambridgeKnowledgeItemsRepositoryPort,
  ImportCambridgeKnowledgeServiceDeps,
  PdfExtractor,
} from './import-cambridge-knowledge.service';
import type { CambridgeChunkClassifier } from './classify-cambridge-chunk';
import type { EmbeddingClient } from './embed-cambridge-chunks';
import type { CreateSourceData } from '../../repositories/cambridge-sources.repository';
import type { CreateKnowledgeItemData } from '../../repositories/cambridge-knowledge-items.repository';
import type { CambridgeSource } from '../../models/CambridgeSource';
import { CambridgeSourceStatus } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { ExtractedPdf } from '../../lib/cambridge-pdf-extractor';

// This suite fakes PDF extraction too (via PdfExtractor — see its doc
// comment in import-cambridge-knowledge.service.ts) rather than running
// real PDFs through pdf-parse: real-PDF parsing is covered once, in
// isolation, by cambridge-pdf-extractor.test.ts. What matters HERE is the
// service's own orchestration logic (idempotency, transactionality,
// rollback, error mapping) given whatever ExtractedPdf it receives — the
// exact bytes that produced it are irrelevant to any assertion below.

function fakeExtractedPdf(overrides: Partial<ExtractedPdf> = {}): ExtractedPdf {
  return {
    checksum: 'a'.repeat(64),
    pageCount: 2,
    pages: ['First page content.', 'Second page content.'],
    ...overrides,
  };
}

function fakePdfExtractor(result: ExtractedPdf | (() => ExtractedPdf)): PdfExtractor {
  return {
    extract: async () => (typeof result === 'function' ? result() : result),
  };
}

// ── Fake DataSource with REAL commit/rollback semantics ─────────────────────
// The transaction wrapper stages every write against a copy of the
// committed store; a thrown error inside `work` propagates WITHOUT merging
// the staging copy back — the same all-or-nothing behavior a real Postgres
// transaction gives you. This is what lets the rollback test below assert
// something meaningful (nothing persisted) instead of merely "the fake was
// called".

interface Staging {
  sources: Map<string, CambridgeSource>;
  itemCount: number;
}

function makeFakeDataSource() {
  const committed: Staging = { sources: new Map(), itemCount: 0 };

  const dataSource = {
    transaction: async <T>(work: (manager: unknown) => Promise<T>): Promise<T> => {
      const staging: Staging = {
        sources: new Map(committed.sources),
        itemCount: committed.itemCount,
      };
      const result = await work(staging);
      committed.sources = staging.sources;
      committed.itemCount = staging.itemCount;
      return result;
    },
  };

  return { dataSource: dataSource as unknown as DataSource, committed };
}

let sourceIdCounter = 0;

function makeSource(overrides: Partial<CambridgeSource> = {}): CambridgeSource {
  sourceIdCounter += 1;
  return {
    id: `source-${sourceIdCounter}`,
    name: 'B2 First Handbook',
    description: null,
    version: '2024',
    status: CambridgeSourceStatus.ACTIVE,
    checksum: 'x'.repeat(64),
    page_count: 1,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as CambridgeSource;
}

interface MakeServiceOptions {
  dataSource: DataSource;
  committed: Staging;
  pdfExtractor?: PdfExtractor;
  classifier?: CambridgeChunkClassifier;
  embeddingClient?: EmbeddingClient;
  bulkInsertImpl?: (items: CreateKnowledgeItemData[], staging: Staging) => Promise<number>;
}

function makeService(options: MakeServiceOptions): {
  service: ImportCambridgeKnowledgeService;
  classifyCalls: { content: string; page: number }[];
  embedCalls: string[][];
  bulkInsertCalls: CreateKnowledgeItemData[][];
} {
  const classifyCalls: { content: string; page: number }[] = [];
  const embedCalls: string[][] = [];
  const bulkInsertCalls: CreateKnowledgeItemData[][] = [];

  const pdfExtractor: PdfExtractor = options.pdfExtractor ?? fakePdfExtractor(fakeExtractedPdf());

  const classifier: CambridgeChunkClassifier = options.classifier ?? {
    classify: async (content, page) => {
      classifyCalls.push({ content, page });
      return {
        paperCode: 'PAPER_1',
        partCode: 'UOE_PART_1',
        skills: ['use-of-english'],
        topics: [],
      };
    },
  };

  const embeddingClient: EmbeddingClient = options.embeddingClient ?? {
    defaultModel: 'fake-embedding-model',
    embed: async (texts) => {
      embedCalls.push(texts);
      return texts.map((_, i) => [i, i + 1, i + 2]);
    },
  };

  const sources = (source: unknown): CambridgeSourcesRepositoryPort => ({
    findByChecksum: async (checksum) => {
      // Only ever called against the top-level dataSource (pre-transaction check).
      for (const s of options.committed.sources.values()) {
        if (s.checksum === checksum) return s;
      }
      return null;
    },
    createSource: async (data: CreateSourceData) => {
      const staging = source as Staging;
      const created = makeSource({
        name: data.name,
        description: data.description,
        version: data.version,
        checksum: data.checksum,
        page_count: data.pageCount,
      });
      staging.sources.set(created.id, created);
      return created;
    },
    listSources: async () => [],
  });

  const items = (source: unknown): CambridgeKnowledgeItemsRepositoryPort => ({
    bulkInsert: async (data: CreateKnowledgeItemData[]) => {
      bulkInsertCalls.push(data);
      const staging = source as Staging;
      if (options.bulkInsertImpl) return options.bulkInsertImpl(data, staging);
      staging.itemCount += data.length;
      return data.length;
    },
  });

  const deps: ImportCambridgeKnowledgeServiceDeps = {
    classifier,
    embeddingClient,
    pdfExtractor,
    sources,
    items,
  };
  return {
    service: new ImportCambridgeKnowledgeService(options.dataSource, deps),
    classifyCalls,
    embedCalls,
    bulkInsertCalls,
  };
}

const VALID_FILE = Buffer.from(
  '%PDF-1.4 fake bytes, never really parsed — pdfExtractor is faked in this suite',
);

describe('ImportCambridgeKnowledgeService', () => {
  it('rejects blank name/version and an empty file', async () => {
    const { dataSource, committed } = makeFakeDataSource();
    const { service } = makeService({ dataSource, committed });

    await assert.rejects(
      () => service.execute({ name: '  ', description: null, version: '1.0', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
    await assert.rejects(
      () => service.execute({ name: 'Handbook', description: null, version: '', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
    await assert.rejects(
      () =>
        service.execute({
          name: 'Handbook',
          description: null,
          version: '1.0',
          file: Buffer.alloc(0),
        }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
  });

  it('rejects a file over the size limit without touching extraction', async () => {
    const { dataSource, committed } = makeFakeDataSource();
    let extractorCalled = false;
    const { service } = makeService({
      dataSource,
      committed,
      pdfExtractor: {
        extract: async () => {
          extractorCalled = true;
          return fakeExtractedPdf();
        },
      },
    });
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1);

    await assert.rejects(
      () =>
        service.execute({ name: 'Handbook', description: null, version: '1.0', file: oversized }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.INVALID_INPUT,
    );
    assert.equal(extractorCalled, false);
  });

  it('maps a PDF extraction failure to EXTRACTION_FAILED', async () => {
    const { dataSource, committed } = makeFakeDataSource();
    const { service } = makeService({
      dataSource,
      committed,
      pdfExtractor: {
        extract: async () => {
          throw new Error('not a PDF');
        },
      },
    });

    await assert.rejects(
      () =>
        service.execute({ name: 'Handbook', description: null, version: '1.0', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.EXTRACTION_FAILED,
    );
  });

  it('rejects a PDF with zero pages as EXTRACTION_FAILED', async () => {
    const { dataSource, committed } = makeFakeDataSource();
    const { service } = makeService({
      dataSource,
      committed,
      pdfExtractor: fakePdfExtractor(fakeExtractedPdf({ pageCount: 0, pages: [] })),
    });

    await assert.rejects(
      () =>
        service.execute({ name: 'Handbook', description: null, version: '1.0', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.EXTRACTION_FAILED,
    );
  });

  it('idempotency: a checksum that already exists short-circuits before classifying/embedding/persisting anything new', async () => {
    const { dataSource, committed } = makeFakeDataSource();
    const checksum = 'b'.repeat(64);
    const existing = makeSource({ checksum });
    committed.sources.set(existing.id, existing);

    const { service, classifyCalls, embedCalls, bulkInsertCalls } = makeService({
      dataSource,
      committed,
      pdfExtractor: fakePdfExtractor(fakeExtractedPdf({ checksum })),
    });

    const result = await service.execute({
      name: 'Handbook',
      description: null,
      version: '1.0',
      file: VALID_FILE,
    });

    assert.equal(result.idempotentReplay, true);
    assert.equal(result.chunkCount, 0);
    assert.equal(result.source.id, existing.id);
    assert.equal(classifyCalls.length, 0);
    assert.equal(embedCalls.length, 0);
    assert.equal(bulkInsertCalls.length, 0);
    // Nothing new was added to the store — still exactly the one pre-existing source.
    assert.equal(committed.sources.size, 1);
  });

  it('persists every chunk with correct source/page traceability back to the new source', async () => {
    const { dataSource, committed } = makeFakeDataSource();

    const { service, bulkInsertCalls } = makeService({ dataSource, committed });

    const result = await service.execute({
      name: 'B2 First Handbook',
      description: 'Official handbook',
      version: '2024',
      file: VALID_FILE,
    });

    assert.equal(result.idempotentReplay, false);
    assert.equal(result.chunkCount, 2);
    assert.equal(bulkInsertCalls.length, 1);
    const persisted = bulkInsertCalls[0];
    assert.equal(persisted.length, 2);

    // Every item traces back to the exact page its text came from, and to
    // the newly created source (never null, never a different source).
    const byPage = new Map(persisted.map((p) => [p.sourcePage, p]));
    assert.ok(byPage.get(1)!.content.includes('First page content'));
    assert.ok(byPage.get(2)!.content.includes('Second page content'));
    for (const item of persisted) {
      assert.equal(item.sourceId, result.source.id);
      assert.equal(item.examCode, 'B2_FIRST');
    }

    // And it's really committed (not staged-only) after a successful import.
    assert.equal(committed.sources.size, 1);
    assert.equal(committed.itemCount, 2);
  });

  it('rollback: a bulkInsert failure leaves NOTHING committed — not even the source that was created first in the same transaction', async () => {
    const { dataSource, committed } = makeFakeDataSource();

    const { service } = makeService({
      dataSource,
      committed,
      bulkInsertImpl: async () => {
        throw new Error('simulated DB failure while inserting items');
      },
    });

    await assert.rejects(() =>
      service.execute({ name: 'Handbook', description: null, version: '1.0', file: VALID_FILE }),
    );

    // The rollback is real: the source created earlier in the same
    // transaction never lands in the committed store either.
    assert.equal(committed.sources.size, 0);
    assert.equal(committed.itemCount, 0);
  });

  it('persistence inconsistency: bulkInsert reporting fewer rows than chunks sent rolls back and throws PERSISTENCE_INCONSISTENCY', async () => {
    const { dataSource, committed } = makeFakeDataSource();

    const { service } = makeService({
      dataSource,
      committed,
      bulkInsertImpl: async (data, staging) => {
        staging.itemCount += data.length;
        return data.length - 1; // under-report — simulates a partial write
      },
    });

    await assert.rejects(
      () =>
        service.execute({ name: 'Handbook', description: null, version: '1.0', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.PERSISTENCE_INCONSISTENCY,
    );
    assert.equal(committed.sources.size, 0);
  });

  it('maps a classifier LLM failure to an ImportCambridgeKnowledgeError before ever opening a transaction', async () => {
    const { dataSource, committed } = makeFakeDataSource();

    const { service } = makeService({
      dataSource,
      committed,
      classifier: {
        classify: async () => {
          throw new LLMServiceError('rate limited', LLMErrorCode.RATE_LIMITED);
        },
      },
    });

    await assert.rejects(
      () =>
        service.execute({ name: 'Handbook', description: null, version: '1.0', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.AI_RATE_LIMITED,
    );
    assert.equal(committed.sources.size, 0);
  });

  it('maps an embedding provider failure to an ImportCambridgeKnowledgeError', async () => {
    const { dataSource, committed } = makeFakeDataSource();

    const { service } = makeService({
      dataSource,
      committed,
      embeddingClient: {
        defaultModel: 'fake',
        embed: async () => {
          throw new LLMServiceError('not configured', LLMErrorCode.NOT_CONFIGURED);
        },
      },
    });

    await assert.rejects(
      () =>
        service.execute({ name: 'Handbook', description: null, version: '1.0', file: VALID_FILE }),
      (err: unknown) =>
        err instanceof ImportCambridgeKnowledgeError &&
        err.code === ImportCambridgeKnowledgeErrorCode.AI_CONFIGURATION_ERROR,
    );
  });
});
