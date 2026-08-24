import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { OpenAIEmbeddingClient } from './embed-cambridge-chunks';
import type { OpenAIEmbeddingClientPort } from './embed-cambridge-chunks';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';

describe('OpenAIEmbeddingClient', () => {
  // OPENAI_EMBEDDING_MODEL missing from serverless.env.yml resolved to '' via
  // the `, ''` fallback in the serverless configs; that blank slipped past the
  // old default parameter and was sent as an empty model id, so every
  // Knowledge Base search 400'd with "you must provide a model parameter".
  it('falls back to the default model when the configured value is blank', () => {
    const client: OpenAIEmbeddingClientPort = {
      embeddings: { create: async () => ({}) as never },
    };
    for (const blank of ['', '   ']) {
      assert.equal(
        new OpenAIEmbeddingClient(client, blank).defaultModel,
        'text-embedding-3-small',
      );
    }
  });

  it('returns vectors sorted by response index, not response array order', async () => {
    const client: OpenAIEmbeddingClientPort = {
      embeddings: {
        create: async () =>
          ({
            object: 'list',
            model: 'text-embedding-3-small',
            data: [
              { object: 'embedding', index: 1, embedding: [0.2, 0.2] },
              { object: 'embedding', index: 0, embedding: [0.1, 0.1] },
            ],
            usage: { prompt_tokens: 10, total_tokens: 10 },
          }) as never,
      },
    };
    const embedder = new OpenAIEmbeddingClient(client);

    const result = await embedder.embed(['first', 'second']);

    assert.deepEqual(result, [
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
  });

  it('sends every text as a single batched request', async () => {
    let capturedInput: unknown;
    let capturedModel: unknown;
    const client: OpenAIEmbeddingClientPort = {
      embeddings: {
        create: async (params) => {
          capturedInput = params.input;
          capturedModel = params.model;
          return {
            object: 'list',
            model: 'text-embedding-3-small',
            data: (params.input as string[]).map((_, index) => ({
              object: 'embedding' as const,
              index,
              embedding: [index],
            })),
            usage: { prompt_tokens: 1, total_tokens: 1 },
          };
        },
      },
    };
    const embedder = new OpenAIEmbeddingClient(client, 'text-embedding-3-small');

    await embedder.embed(['a', 'b', 'c']);

    assert.deepEqual(capturedInput, ['a', 'b', 'c']);
    assert.equal(capturedModel, 'text-embedding-3-small');
  });

  it('returns an empty array without calling the provider when given no texts', async () => {
    let called = false;
    const client: OpenAIEmbeddingClientPort = {
      embeddings: {
        create: async () => {
          called = true;
          throw new Error('should not be called');
        },
      },
    };
    const embedder = new OpenAIEmbeddingClient(client);

    const result = await embedder.embed([]);

    assert.deepEqual(result, []);
    assert.equal(called, false);
  });

  it('maps any provider error through the shared OpenAI error mapper into an LLMServiceError', async () => {
    const client: OpenAIEmbeddingClientPort = {
      embeddings: {
        create: async () => {
          throw new Error('network exploded');
        },
      },
    };
    const embedder = new OpenAIEmbeddingClient(client);

    await assert.rejects(
      () => embedder.embed(['text']),
      (err: unknown) => err instanceof LLMServiceError && err.code === LLMErrorCode.PROVIDER_ERROR,
    );
  });
});
