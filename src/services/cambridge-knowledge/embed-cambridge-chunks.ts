import type OpenAI from 'openai';
import { mapOpenAIError } from '../llm/openai.provider';

/**
 * Port every embedding provider adapter must implement. Kept separate from
 * llm.types.ts's LLMProvider — embeddings is a different OpenAI API surface
 * (client.embeddings.create, not chat completions) with its own model
 * family (text-embedding-3-*), so it doesn't belong behind the same
 * chat/structured-output port. Same "declare the port next to its one real
 * consumer" convention as StructuredLLM in practice-recommendation-generator.ts.
 */
export interface EmbeddingClient {
  readonly defaultModel: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface OpenAIEmbeddingClientPort {
  embeddings: {
    create(params: OpenAI.EmbeddingCreateParams): Promise<OpenAI.CreateEmbeddingResponse>;
  };
}

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/** EmbeddingClient adapter backed by the OpenAI Embeddings API. */
export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly defaultModel: string;

  constructor(
    private readonly client: OpenAIEmbeddingClientPort,
    defaultModel: string = DEFAULT_EMBEDDING_MODEL,
  ) {
    this.defaultModel = defaultModel;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: OpenAI.CreateEmbeddingResponse;
    try {
      response = await this.client.embeddings.create({
        model: this.defaultModel,
        input: texts,
      });
    } catch (err: unknown) {
      throw mapOpenAIError(err);
    }

    // The API guarantees `data` is returned in the same order as `input`
    // (each entry's `.index` matches its position) — sort defensively
    // rather than trusting response order blindly.
    return [...response.data].sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
  }
}
