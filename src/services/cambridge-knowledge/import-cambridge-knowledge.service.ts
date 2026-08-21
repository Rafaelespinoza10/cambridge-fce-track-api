import type { DataSource, EntityManager } from 'typeorm';
import { extractPdf } from '../../lib/cambridge-pdf-extractor';
import type { ExtractedPdf } from '../../lib/cambridge-pdf-extractor';
import { stripRepeatedHeadersAndFooters } from '../../lib/cambridge-text-cleaner';
import { chunkPages } from '../../lib/cambridge-chunker';
import type { CambridgeChunk } from '../../lib/cambridge-chunker';
import { CAMBRIDGE_EXAM_CODE } from '../../lib/cambridge-knowledge-catalog';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  CambridgeChunkClassifier,
  CambridgeChunkClassification,
} from './classify-cambridge-chunk';
import type { EmbeddingClient } from './embed-cambridge-chunks';
import {
  CambridgeSourcesRepository,
  toSourceDto,
} from '../../repositories/cambridge-sources.repository';
import type {
  CambridgeSourceDto,
  CreateSourceData,
} from '../../repositories/cambridge-sources.repository';
import { CambridgeKnowledgeItemsRepository } from '../../repositories/cambridge-knowledge-items.repository';
import type { CreateKnowledgeItemData } from '../../repositories/cambridge-knowledge-items.repository';
import type { CambridgeSource } from '../../models/CambridgeSource';

export enum ImportCambridgeKnowledgeErrorCode {
  INVALID_INPUT = 'invalid_input',
  EXTRACTION_FAILED = 'extraction_failed',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class ImportCambridgeKnowledgeError extends Error {
  constructor(
    message: string,
    readonly code: ImportCambridgeKnowledgeErrorCode,
  ) {
    super(message);
    this.name = 'ImportCambridgeKnowledgeError';
  }
}

export interface ImportCambridgeKnowledgeInput {
  name: string;
  description: string | null;
  version: string;
  file: Buffer;
}

export interface ImportCambridgeKnowledgeResult {
  source: CambridgeSourceDto;
  chunkCount: number;
  /** True when this exact PDF (by sha256 checksum) was already imported — nothing new was extracted, classified, embedded or persisted. */
  idempotentReplay: boolean;
}

type RepositorySource = DataSource | EntityManager;

export interface CambridgeSourcesRepositoryPort {
  findByChecksum(checksum: string): Promise<CambridgeSource | null>;
  createSource(data: CreateSourceData): Promise<CambridgeSource>;
  listSources(): Promise<CambridgeSourceDto[]>;
}

export interface CambridgeKnowledgeItemsRepositoryPort {
  bulkInsert(items: CreateKnowledgeItemData[]): Promise<number>;
}

/**
 * Port around PDF text extraction — same "declare a port, inject a fake in
 * tests" shape as classifier/embeddingClient below, for a different reason:
 * this one isn't about avoiding a real network call, it's isolation from
 * pdf-parse's bundled (2018-era) pdfjs, which is unreliable when many
 * DIFFERENT small PDF buffers are parsed back-to-back in one process (see
 * the comment on GENERIC_PDF/TRACEABLE_PDF in this service's test file).
 * The real adapter (extractPdfAdapter, wired in cambridge-knowledge-
 * composition.ts) is exercised for real in cambridge-pdf-extractor.test.ts
 * instead, which keeps that risk contained to one small, dedicated file.
 */
export interface PdfExtractor {
  extract(buffer: Buffer): Promise<ExtractedPdf>;
}

export const extractPdfAdapter: PdfExtractor = { extract: extractPdf };

export interface ImportCambridgeKnowledgeServiceDeps {
  classifier: CambridgeChunkClassifier;
  embeddingClient: EmbeddingClient;
  pdfExtractor?: PdfExtractor;
  sources?: (source: RepositorySource) => CambridgeSourcesRepositoryPort;
  items?: (source: RepositorySource) => CambridgeKnowledgeItemsRepositoryPort;
  /** Caps concurrent classification calls against the LLM — see mapWithConcurrency. */
  classificationConcurrency?: number;
}

const DEFAULT_SOURCES_FACTORY = (source: RepositorySource): CambridgeSourcesRepositoryPort =>
  new CambridgeSourcesRepository(source);
const DEFAULT_ITEMS_FACTORY = (source: RepositorySource): CambridgeKnowledgeItemsRepositoryPort =>
  new CambridgeKnowledgeItemsRepository(source);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_CLASSIFICATION_CONCURRENCY = 5;

function invalidInput(message: string): never {
  throw new ImportCambridgeKnowledgeError(message, ImportCambridgeKnowledgeErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Runs `work` over `items` with at most `concurrency` in flight at once — a classify-per-chunk import shouldn't fire hundreds of simultaneous LLM requests. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await work(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function mapLLMError(error: unknown): ImportCambridgeKnowledgeError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new ImportCambridgeKnowledgeError(
          'The AI provider is not configured correctly',
          ImportCambridgeKnowledgeErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new ImportCambridgeKnowledgeError(
          'The AI provider is rate-limiting requests',
          ImportCambridgeKnowledgeErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new ImportCambridgeKnowledgeError(
          'The AI provider took too long to respond',
          ImportCambridgeKnowledgeErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new ImportCambridgeKnowledgeError(
          'The AI provider is currently unavailable',
          ImportCambridgeKnowledgeErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new ImportCambridgeKnowledgeError(
          'The AI provider returned an invalid response',
          ImportCambridgeKnowledgeErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new ImportCambridgeKnowledgeError(
    'The AI provider returned an unexpected error',
    ImportCambridgeKnowledgeErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/**
 * Imports one Cambridge PDF into the shared Knowledge Base. Pipeline: parse
 * -> checksum idempotency check -> clean -> chunk -> classify + embed (every
 * network call happens here, BEFORE any DB transaction opens — same house
 * rule SubmitWritingSubmissionService follows: never hold a transaction
 * across network I/O) -> one transaction that persists the source and every
 * item together, so a failure at any point during persistence rolls back
 * the whole import instead of leaving a source with partial/missing chunks.
 */
export class ImportCambridgeKnowledgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: ImportCambridgeKnowledgeServiceDeps,
  ) {}

  async execute(input: ImportCambridgeKnowledgeInput): Promise<ImportCambridgeKnowledgeResult> {
    if (!isNonEmptyString(input.name)) invalidInput('name is required');
    if (!isNonEmptyString(input.version)) invalidInput('version is required');
    if (!Buffer.isBuffer(input.file) || input.file.length === 0) {
      invalidInput('file is required and must not be empty');
    }
    if (input.file.length > MAX_FILE_SIZE_BYTES) {
      invalidInput(`file exceeds the ${MAX_FILE_SIZE_BYTES} byte limit`);
    }

    const sourcesFactory = this.deps.sources ?? DEFAULT_SOURCES_FACTORY;
    const itemsFactory = this.deps.items ?? DEFAULT_ITEMS_FACTORY;
    const pdfExtractor = this.deps.pdfExtractor ?? extractPdfAdapter;

    let extracted;
    try {
      extracted = await pdfExtractor.extract(input.file);
    } catch (err: unknown) {
      throw new ImportCambridgeKnowledgeError(
        `Failed to extract text from the PDF: ${err instanceof Error ? err.message : 'unknown error'}`,
        ImportCambridgeKnowledgeErrorCode.EXTRACTION_FAILED,
      );
    }
    if (extracted.pageCount === 0) {
      throw new ImportCambridgeKnowledgeError(
        'The PDF has no pages',
        ImportCambridgeKnowledgeErrorCode.EXTRACTION_FAILED,
      );
    }

    // Idempotency short-circuit: same bytes already imported, do no further
    // (expensive) work. A concurrent duplicate import racing this check is
    // still safe — cambridge_sources.checksum is UNIQUE at the DB level, so
    // the transaction below fails loudly instead of double-importing.
    const existing = await sourcesFactory(this.dataSource).findByChecksum(extracted.checksum);
    if (existing !== null) {
      return { source: toSourceDto(existing), chunkCount: 0, idempotentReplay: true };
    }

    const cleanedPages = stripRepeatedHeadersAndFooters(extracted.pages);
    const chunks = chunkPages(cleanedPages);
    if (chunks.length === 0) {
      throw new ImportCambridgeKnowledgeError(
        'No usable text chunks were extracted from the PDF',
        ImportCambridgeKnowledgeErrorCode.EXTRACTION_FAILED,
      );
    }

    const itemsData = await this.classifyAndEmbed(chunks);

    return this.dataSource.transaction(async (manager) => {
      const source = await sourcesFactory(manager).createSource({
        name: input.name.trim(),
        description: input.description,
        version: input.version.trim(),
        checksum: extracted.checksum,
        pageCount: extracted.pageCount,
      });

      const insertedCount = await itemsFactory(manager).bulkInsert(
        itemsData.map((item) => ({ ...item, sourceId: source.id })),
      );
      if (insertedCount !== itemsData.length) {
        throw new ImportCambridgeKnowledgeError(
          'Persisted item count did not match the number of chunks produced',
          ImportCambridgeKnowledgeErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }

      return {
        source: toSourceDto(source),
        chunkCount: itemsData.length,
        idempotentReplay: false,
      };
    });
  }

  private async classifyAndEmbed(
    chunks: CambridgeChunk[],
  ): Promise<Omit<CreateKnowledgeItemData, 'sourceId'>[]> {
    let classifications: CambridgeChunkClassification[];
    try {
      classifications = await mapWithConcurrency(
        chunks,
        this.deps.classificationConcurrency ?? DEFAULT_CLASSIFICATION_CONCURRENCY,
        (chunk) => this.deps.classifier.classify(chunk.content, chunk.sourcePage),
      );
    } catch (err: unknown) {
      throw mapLLMError(err);
    }

    let embeddings: number[][];
    try {
      embeddings = await this.deps.embeddingClient.embed(chunks.map((chunk) => chunk.content));
    } catch (err: unknown) {
      throw mapLLMError(err);
    }
    if (embeddings.length !== chunks.length) {
      throw new ImportCambridgeKnowledgeError(
        'The embedding provider returned a different number of vectors than chunks sent',
        ImportCambridgeKnowledgeErrorCode.AI_INVALID_RESPONSE,
      );
    }

    return chunks.map((chunk, index) => ({
      examCode: CAMBRIDGE_EXAM_CODE,
      paperCode: classifications[index].paperCode,
      partCode: classifications[index].partCode,
      skills: classifications[index].skills,
      topics: classifications[index].topics,
      content: chunk.content,
      sourcePage: chunk.sourcePage,
      sourceSection: null,
      embedding: embeddings[index],
      metadata: { chunkIndexInPage: chunk.chunkIndexInPage },
    }));
  }
}
