import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { APIError, APIConnectionTimeoutError } from 'openai';
import type OpenAI from 'openai';

import { OpenAIProvider } from './openai.provider';
import type { OpenAIClientPort } from './openai.provider';
import { LLMServiceError, LLMErrorCode } from './llm.types';
import type {
  LLMProviderCompletionParams,
  LLMProviderStructuredCompletionParams,
} from './llm.types';

const PARAMS: LLMProviderCompletionParams = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.7,
  maxOutputTokens: 1024,
};

const STRUCTURED_PARAMS: LLMProviderStructuredCompletionParams = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.7,
  maxOutputTokens: 1024,
  responseSchema: {
    name: 'fake_schema',
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
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

function makeResponse(outputText: string): OpenAI.Responses.Response {
  return {
    id: 'resp-1',
    created_at: 0,
    output_text: outputText,
    error: null,
  } as unknown as OpenAI.Responses.Response;
}

const UNUSED_CHAT_CREATE: OpenAIClientPort['chat']['completions']['create'] = async () => {
  throw new Error('chat.completions.create should not be called in this test');
};
const UNUSED_RESPONSES_CREATE: OpenAIClientPort['responses']['create'] = async () => {
  throw new Error('responses.create should not be called in this test');
};

function makeProvider(create: OpenAIClientPort['chat']['completions']['create']): OpenAIProvider {
  const client: OpenAIClientPort = {
    chat: { completions: { create } },
    responses: { create: UNUSED_RESPONSES_CREATE },
  };
  return new OpenAIProvider(client);
}

function makeResponsesProvider(create: OpenAIClientPort['responses']['create']): OpenAIProvider {
  const client: OpenAIClientPort = {
    chat: { completions: { create: UNUSED_CHAT_CREATE } },
    responses: { create },
  };
  return new OpenAIProvider(client);
}

describe('OpenAIProvider', () => {
  it('exposes a default model when none is passed to the constructor', () => {
    const provider = makeProvider(async () => makeCompletion('unused'));
    assert.equal(provider.defaultModel, 'gpt-4o-mini');
  });

  it('lets the constructor override the default model', () => {
    const provider = new OpenAIProvider(
      {
        chat: { completions: { create: async () => makeCompletion('unused') } },
        responses: { create: UNUSED_RESPONSES_CREATE },
      },
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

  it('retries once without temperature when the model rejects that parameter', async () => {
    let attempts = 0;
    const provider = makeProvider(async (params) => {
      attempts++;
      if ('temperature' in params) {
        throw new APIError(
          400,
          { message: "Unsupported parameter: 'temperature' is not supported with this model." },
          undefined,
          new Headers(),
        );
      }
      return makeCompletion('ok without temperature');
    });

    const result = await provider.createCompletion(PARAMS);

    assert.equal(attempts, 2);
    assert.deepEqual(result, { content: 'ok without temperature' });
  });

  it('does not retry for an unrelated 400 error', async () => {
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts++;
      throw new APIError(400, {}, 'Invalid request: model not found', new Headers());
    });

    await assert.rejects(() => provider.createCompletion(PARAMS));
    assert.equal(attempts, 1);
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

describe('OpenAIProvider.createStructuredCompletion', () => {
  it('sends the Responses API request with json_schema Structured Outputs', async () => {
    let capturedBody: unknown;
    let capturedOptions: unknown;
    const provider = makeResponsesProvider(async (body, options) => {
      capturedBody = body;
      capturedOptions = options;
      return makeResponse('{"ok":true}');
    });

    await provider.createStructuredCompletion({ ...STRUCTURED_PARAMS, timeoutMs: 5000 });

    assert.deepEqual(capturedBody, {
      model: 'gpt-4o-mini',
      input: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      max_output_tokens: 1024,
      text: {
        format: {
          type: 'json_schema',
          name: 'fake_schema',
          schema: { type: 'object', properties: {}, additionalProperties: false },
          strict: true,
        },
      },
    });
    assert.deepEqual(capturedOptions, { timeout: 5000 });
  });

  it('omits request options when no timeout is given', async () => {
    let capturedOptions: unknown = 'not-called';
    const provider = makeResponsesProvider(async (_body, options) => {
      capturedOptions = options;
      return makeResponse('{"ok":true}');
    });

    await provider.createStructuredCompletion(STRUCTURED_PARAMS);

    assert.equal(capturedOptions, undefined);
  });

  it('respects an explicit strict:false on the schema', async () => {
    let capturedBody: any;
    const provider = makeResponsesProvider(async (body) => {
      capturedBody = body;
      return makeResponse('{"ok":true}');
    });

    await provider.createStructuredCompletion({
      ...STRUCTURED_PARAMS,
      responseSchema: { ...STRUCTURED_PARAMS.responseSchema, strict: false },
    });

    assert.equal(capturedBody.text.format.strict, false);
  });

  it('returns output_text from the response', async () => {
    const provider = makeResponsesProvider(async () => makeResponse('{"front":"iron out"}'));

    const result = await provider.createStructuredCompletion(STRUCTURED_PARAMS);

    assert.deepEqual(result, { content: '{"front":"iron out"}' });
  });

  it('returns an empty string when output_text is missing', async () => {
    const provider = makeResponsesProvider(async () =>
      makeResponse(undefined as unknown as string),
    );

    const result = await provider.createStructuredCompletion(STRUCTURED_PARAMS);

    assert.deepEqual(result, { content: '' });
  });

  it('maps a timeout error to TIMEOUT', async () => {
    const provider = makeResponsesProvider(async () => {
      throw new APIConnectionTimeoutError();
    });

    await assert.rejects(
      () => provider.createStructuredCompletion(STRUCTURED_PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.TIMEOUT);
        assert.equal(err.statusCode, 504);
        return true;
      },
    );
  });

  it('maps a 429 error to RATE_LIMITED', async () => {
    const provider = makeResponsesProvider(async () => {
      throw new APIError(429, {}, 'Too Many Requests', new Headers());
    });

    await assert.rejects(
      () => provider.createStructuredCompletion(STRUCTURED_PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.RATE_LIMITED);
        return true;
      },
    );
  });

  it('maps a non-APIError failure to PROVIDER_ERROR', async () => {
    const provider = makeResponsesProvider(async () => {
      throw new Error('boom');
    });

    await assert.rejects(
      () => provider.createStructuredCompletion(STRUCTURED_PARAMS),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.PROVIDER_ERROR);
        return true;
      },
    );
  });

  it('retries once without temperature when the model rejects that parameter', async () => {
    let attempts = 0;
    const provider = makeResponsesProvider(async (body) => {
      attempts++;
      if ('temperature' in body) {
        throw new APIError(
          400,
          { message: "Unsupported parameter: 'temperature' is not supported with this model." },
          undefined,
          new Headers(),
        );
      }
      return makeResponse('ok without temperature');
    });

    const result = await provider.createStructuredCompletion(STRUCTURED_PARAMS);

    assert.equal(attempts, 2);
    assert.deepEqual(result, { content: 'ok without temperature' });
  });

  it('does not retry for an unrelated 400 error', async () => {
    let attempts = 0;
    const provider = makeResponsesProvider(async () => {
      attempts++;
      throw new APIError(400, {}, 'Invalid request: model not found', new Headers());
    });

    await assert.rejects(() => provider.createStructuredCompletion(STRUCTURED_PARAMS));
    assert.equal(attempts, 1);
  });
});
