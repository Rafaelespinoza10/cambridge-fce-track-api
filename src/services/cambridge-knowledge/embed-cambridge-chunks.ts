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

  /**
   * Blank-tolerant for the same reason as OpenAIProvider's: callers pass
   * `process.env['OPENAI_EMBEDDING_MODEL']`, which the serverless configs
   * resolve with a `, ''` fallback. When that key was absent from
   * serverless.env.yml the deployed Lambdas got `''`, sailed past the old
   * default parameter, and every Knowledge Base search died with
   * "you must provide a model parameter" — surfacing to users as an
   * unrelated-looking "the AI returned something unusable".
   */
  constructor(
    private readonly client: OpenAIEmbeddingClientPort,
    defaultModel?: string,
  ) {
    this.defaultModel = defaultModel?.trim() ? defaultModel.trim() : DEFAULT_EMBEDDING_MODEL;
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
