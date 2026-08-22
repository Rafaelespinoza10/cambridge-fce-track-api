import type { DataSource, EntityManager, Repository } from 'typeorm';
import { CambridgeKnowledgeItem } from '@models/CambridgeKnowledgeItem';
import { CambridgeSourceStatus } from '@models/enums';
import type { CambridgeKnowledgeItemMetadata } from '@models/cambridge-knowledge-json-types';
import {
  isSafeCambridgeMetadata,
  isEmbeddingVector,
  normalizeStringArray,
} from '@lib/cambridge-knowledge/cambridge-jsonb-validators';

export interface CreateKnowledgeItemData {
  sourceId: string;
  examCode: string;
  paperCode: string | null;
  partCode: string | null;
  skills: string[];
  topics: string[];
  content: string;
  sourcePage: number;
  sourceSection: string | null;
  embedding: number[];
  metadata: CambridgeKnowledgeItemMetadata | null;
}

export interface KnowledgeItemSearchFilters {
  paperCode?: string;
  partCode?: string;
  skill?: string;
  topic?: string;
}

/** A candidate row for ranking — never includes the embedding vector past the repository boundary (see SearchCambridgeKnowledgeService). */
export interface KnowledgeItemSearchCandidate {
  id: string;
  content: string;
  sourceName: string;
  sourcePage: number;
  paperCode: string | null;
  partCode: string | null;
  skills: string[];
  topics: string[];
  embedding: number[];
}

// Hard cap on how many candidate rows a single search pulls into application
// memory for cosine-similarity ranking (see search-cambridge-knowledge.
// service.ts). Generous for a curated, admin-only B2 First corpus; revisit
// together with the JSONB-vs-pgvector tradeoff (see CambridgeKnowledgeItem)
// if the corpus grows well past this.
const MAX_SEARCH_CANDIDATES = 1000;

class CambridgeKnowledgeItemsRepository {
  private readonly itemRepo: Repository<CambridgeKnowledgeItem>;

  constructor(dataSource: DataSource | EntityManager) {
    this.itemRepo = dataSource.getRepository(CambridgeKnowledgeItem);
  }

  /**
   * Persists every chunk produced by one import in a single batch insert.
   * Every item is validated (embedding shape, metadata safety) before any
   * row is written — a batch either persists in full or throws before
   * touching the DB, so ImportCambridgeKnowledgeService's transaction never
   * has to partially roll back mid-batch for a validation reason (only a
   * real DB failure rolls it back).
   */
  async bulkInsert(items: CreateKnowledgeItemData[]): Promise<number> {
    if (items.length === 0) return 0;

    const rows = items.map((item) => {
      if (!isEmbeddingVector(item.embedding)) {
        throw new Error('embedding must be a non-empty array of finite numbers');
      }
      if (!isSafeCambridgeMetadata(item.metadata)) {
        throw new Error('metadata contains a forbidden key (secret, prompt or raw response)');
      }
      return this.itemRepo.create({
        source_id: item.sourceId,
        exam_code: item.examCode,
        paper_code: item.paperCode,
        part_code: item.partCode,
        skills: normalizeStringArray(item.skills),
        topics: normalizeStringArray(item.topics),
        content: item.content,
        source_page: item.sourcePage,
        source_section: item.sourceSection,
        embedding: item.embedding,
        metadata: item.metadata,
      });
    });

    const saved = await this.itemRepo.save(rows);
    return saved.length;
  }

  /**
   * Metadata-filtered candidate rows from active sources only (an inactive
   * source's chunks never surface — see the "fuente inactive no aparece en
   * búsquedas" test). Semantic ranking (cosine similarity against a query
   * embedding) happens in SearchCambridgeKnowledgeService, not here — this
   * method is pure data access.
   */
  async search(filters: KnowledgeItemSearchFilters): Promise<KnowledgeItemSearchCandidate[]> {
    const qb = this.itemRepo
      .createQueryBuilder('item')
      .innerJoin('cambridge_sources', 'source', 'source.id = item.source_id')
      .where('source.status = :status', { status: CambridgeSourceStatus.ACTIVE })
      .select([
        'item.id AS id',
        'item.content AS content',
        'source.name AS source_name',
        'item.source_page AS source_page',
        'item.paper_code AS paper_code',
        'item.part_code AS part_code',
        'item.skills AS skills',
        'item.topics AS topics',
        'item.embedding AS embedding',
      ])
      // Deterministic base ordering even without a semantic query — the
      // service's cosine-similarity sort (see SearchCambridgeKnowledgeService)
      // overrides this for scored results; JS's stable sort preserves it as
      // the tiebreaker/fallback for unscored ones.
      .orderBy('item.created_at', 'DESC')
      .limit(MAX_SEARCH_CANDIDATES);

    if (filters.paperCode !== undefined) {
      qb.andWhere('item.paper_code = :paperCode', { paperCode: filters.paperCode });
    }
    if (filters.partCode !== undefined) {
      qb.andWhere('item.part_code = :partCode', { partCode: filters.partCode });
    }
    if (filters.skill !== undefined) {
      qb.andWhere(':skill = ANY(item.skills)', { skill: filters.skill });
    }
    if (filters.topic !== undefined) {
      qb.andWhere(':topic = ANY(item.topics)', { topic: filters.topic });
    }

    const raw = await qb.getRawMany<{
      id: string;
      content: string;
      source_name: string;
      source_page: number;
      paper_code: string | null;
      part_code: string | null;
      skills: string[];
      topics: string[];
      embedding: number[];
    }>();

    return raw.map((row) => ({
      id: row.id,
      content: row.content,
      sourceName: row.source_name,
      sourcePage: row.source_page,
      paperCode: row.paper_code,
      partCode: row.part_code,
      skills: row.skills ?? [],
      topics: row.topics ?? [],
      embedding: row.embedding,
    }));
  }
}

export { CambridgeKnowledgeItemsRepository, MAX_SEARCH_CANDIDATES };
