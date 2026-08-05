import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { APIError } from 'openai';
import type OpenAI from 'openai';

import { OpenAIProvider } from './openai.provider';
import type { OpenAIClientPort } from './openai.provider';
import { LLMServiceError, LLMErrorCode } from './llm.types';
import type { LLMProviderCompletionParams } from './llm.types';

const PARAMS: LLMProviderCompletionParams = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.7,
  maxOutputTokens: 1024,
};

function makeCompletion(content: string | null): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          refusal: null,
        } as OpenAI.Chat.Completions.ChatCompletionMessage,
      },
    ],
  } as unknown as OpenAI.Chat.Completions.ChatCompletion;
}

function makeProvider(create: OpenAIClientPort['chat']['completions']['create']): OpenAIProvider {
  const client: OpenAIClientPort = { chat: { completions: { create } } };
  return new OpenAIProvider(client);
}

describe('OpenAIProvider', () => {
  it('exposes a default model when none is passed to the constructor', () => {
    const provider = makeProvider(async () => makeCompletion('unused'));
    assert.equal(provider.defaultModel, 'gpt-4o-mini');
  });

  it('lets the constructor override the default model', () => {
    const provider = new OpenAIProvider(
      { chat: { completions: { create: async () => makeCompletion('unused') } } },
      'gpt-4o',
    );
    assert.equal(provider.defaultModel, 'gpt-4o');
  });

  it('translates params to the OpenAI request shape', async () => {
    let capturedParams: unknown;
    const provider = makeProvider(async (params) => {
      capturedParams = params;
      return makeCompletion('answer');
    });

    await provider.createCompletion(PARAMS);

    assert.deepEqual(capturedParams, {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      max_completion_tokens: 1024,
    });
  });

  it('returns the message content from the response', async () => {
    const provider = makeProvider(async () => makeCompletion('Hello there!'));

    const result = await provider.createCompletion(PARAMS);

    assert.deepEqual(result, { content: 'Hello there!' });
  });

  it('returns an empty string when the response has no content', async () => {
    const provider = makeProvider(async () => makeCompletion(null));

    const result = await provider.createCompletion(PARAMS);

    assert.deepEqual(result, { content: '' });
  });

  it('maps a 401 error to AUTHENTICATION_FAILED', async () => {
    const provider = makeProvider(async () => {
      throw new APIError(401, {}, 'Unauthorized', new Headers());
    });

    await assert.rejects(
      () => provider.createCompletion(PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.AUTHENTICATION_FAILED);
        assert.equal(err.statusCode, 500);
        return true;
      },
    );
  });

  it('maps a 429 error to RATE_LIMITED', async () => {
    const provider = makeProvider(async () => {
      throw new APIError(429, {}, 'Too Many Requests', new Headers());
    });

    await assert.rejects(
      () => provider.createCompletion(PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.RATE_LIMITED);
        assert.equal(err.statusCode, 429);
        return true;
      },
    );
  });

  it('maps any other API error to PROVIDER_ERROR', async () => {
    const provider = makeProvider(async () => {
      throw new APIError(500, {}, 'Internal Server Error', new Headers());
    });

    await assert.rejects(
      () => provider.createCompletion(PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.PROVIDER_ERROR);
        return true;
      },
    );
  });

  it('maps a non-APIError failure (e.g. network error) to PROVIDER_ERROR', async () => {
    const provider = makeProvider(async () => {
      throw new Error('socket hang up');
    });

    await assert.rejects(
      () => provider.createCompletion(PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.PROVIDER_ERROR);
        assert.match(err.message, /socket hang up/);
        return true;
      },
    );
  });
});
