import type { DataSource } from 'typeorm';
import { CambridgeKnowledgeItemsRepository } from '@repositories/cambridge-knowledge/cambridge-knowledge-items.repository';
import type { KnowledgeItemSearchCandidate } from '@repositories/cambridge-knowledge/cambridge-knowledge-items.repository';
import type { EmbeddingClient } from './embed-cambridge-chunks';

export enum SearchCambridgeKnowledgeErrorCode {
  INVALID_INPUT = 'invalid_input',
}

export class SearchCambridgeKnowledgeError extends Error {
  constructor(
    message: string,
    readonly code: SearchCambridgeKnowledgeErrorCode,
  ) {
    super(message);
    this.name = 'SearchCambridgeKnowledgeError';
  }
}

export interface SearchCambridgeKnowledgeFilters {
  query?: string;
  paperCode?: string;
  partCode?: string;
  skill?: string;
  topic?: string;
  limit?: number;
}

/** Never includes `embedding` — see the "Nunca devolver embeddings" requirement, enforced by this DTO's shape rather than by remembering to strip a field. */
export interface CambridgeKnowledgeSearchResult {
  content: string;
  sourceName: string;
  sourcePage: number;
  paperCode: string | null;
  partCode: string | null;
  skills: string[];
  topics: string[];
  relevanceScore: number;
}

export interface CambridgeKnowledgeItemsRepositoryPort {
  search(filters: {
    paperCode?: string;
    partCode?: string;
    skill?: string;
    topic?: string;
  }): Promise<KnowledgeItemSearchCandidate[]>;
}

export interface SearchCambridgeKnowledgeServiceDeps {
  embeddingClient: EmbeddingClient;
  items?: (dataSource: DataSource) => CambridgeKnowledgeItemsRepositoryPort;
}

const DEFAULT_ITEMS_FACTORY = (dataSource: DataSource): CambridgeKnowledgeItemsRepositoryPort =>
  new CambridgeKnowledgeItemsRepository(dataSource);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Combines metadata filters (paperCode/partCode/skill/topic — applied in
 * SQL by the repository) with semantic ranking (cosine similarity against
 * a query embedding — computed here in application code; see the JSONB-vs-
 * pgvector tradeoff documented on CambridgeKnowledgeItem). Without a
 * `query`, results are still metadata-filtered but ranked by recency
 * instead of relevance (relevanceScore is 0 for all of them in that case —
 * there's no query vector to score against).
 */
export class SearchCambridgeKnowledgeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SearchCambridgeKnowledgeServiceDeps,
  ) {}

  async execute(
    filters: SearchCambridgeKnowledgeFilters,
  ): Promise<CambridgeKnowledgeSearchResult[]> {
    if (filters.query !== undefined && !isNonEmptyString(filters.query)) {
      throw new SearchCambridgeKnowledgeError(
        'query must not be blank when provided',
        SearchCambridgeKnowledgeErrorCode.INVALID_INPUT,
      );
    }
    const limit = filters.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new SearchCambridgeKnowledgeError(
        `limit must be an integer between 1 and ${MAX_LIMIT}`,
        SearchCambridgeKnowledgeErrorCode.INVALID_INPUT,
      );
    }

    const itemsFactory = this.deps.items ?? DEFAULT_ITEMS_FACTORY;
    const candidates = await itemsFactory(this.dataSource).search({
      paperCode: filters.paperCode,
      partCode: filters.partCode,
      skill: filters.skill,
      topic: filters.topic,
    });

    let queryEmbedding: number[] | null = null;
    if (filters.query !== undefined) {
      const [embedding] = await this.deps.embeddingClient.embed([filters.query.trim()]);
      queryEmbedding = embedding ?? null;
    }

    const scored = candidates.map((candidate) => ({
      candidate,
      relevanceScore:
        queryEmbedding === null ? 0 : cosineSimilarity(queryEmbedding, candidate.embedding),
    }));

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scored.slice(0, limit).map(({ candidate, relevanceScore }) => ({
      content: candidate.content,
      sourceName: candidate.sourceName,
      sourcePage: candidate.sourcePage,
      paperCode: candidate.paperCode,
      partCode: candidate.partCode,
      skills: candidate.skills,
      topics: candidate.topics,
      relevanceScore,
    }));
  }
}
