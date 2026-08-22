/**
 * Shape of `cambridge_knowledge_items.metadata` (JSONB). Intentionally an
 * open-ended, optional bag — same role as WritingTaskGenerationMetadata —
 * but every key here is non-sensitive by construction: never a prompt, an
 * API key, or a raw provider response body (see isSafeCambridgeMetadata,
 * which still guards this at the repository boundary as defense in depth).
 */
export interface CambridgeKnowledgeItemMetadata {
  /** Embedding model id (e.g. "text-embedding-3-small") — needed so search never compares vectors from two different models. */
  embeddingModel?: string;
  /** Vector length, redundant with embedding.length but cheap to check without touching the (larger) embedding column. */
  embeddingDimensions?: number;
  /** Classifier model id (e.g. "gpt-4o-mini") — which model produced paperCode/partCode/skills/topics for this chunk. */
  classificationModel?: string;
  /** Chunk index within its source page (0-based) — several chunks can share the same sourcePage. */
  chunkIndexInPage?: number;
  [key: string]: unknown;
}
