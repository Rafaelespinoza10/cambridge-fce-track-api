import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { LLMService } from './llm.service';
import { LLMServiceError, LLMErrorCode } from './llm.types';
import type {
  LLMJsonSchema,
  LLMProvider,
  LLMProviderCompletionParams,
  LLMProviderResult,
  LLMProviderStructuredCompletionParams,
  LLMProviderStructuredResult,
} from './llm.types';

const DEFAULT_DEPS_OVERRIDES = {
  defaultModel: 'fake-model',
  defaultTemperature: 0.7,
  defaultMaxOutputTokens: 1024,
};

const FAKE_SCHEMA: LLMJsonSchema = {
  name: 'fake_schema',
  schema: { type: 'object', properties: {}, additionalProperties: false },
};

function makeService(
  createCompletion: (params: LLMProviderCompletionParams) => Promise<LLMProviderResult>,
): LLMService {
  const provider: LLMProvider = {
    name: 'fake',
    defaultModel: 'fake-model',
    createCompletion,
    createStructuredCompletion: async () => {
      throw new Error('createStructuredCompletion should not be called in this test');
    },
  };
  return new LLMService({ provider, ...DEFAULT_DEPS_OVERRIDES });
}

function makeStructuredService(
  createStructuredCompletion: (
    params: LLMProviderStructuredCompletionParams,
  ) => Promise<LLMProviderStructuredResult>,
): LLMService {
  const provider: LLMProvider = {
    name: 'fake',
    defaultModel: 'fake-model',
    createCompletion: async () => {
      throw new Error('createCompletion should not be called in this test');
    },
    createStructuredCompletion,
  };
  return new LLMService({ provider, ...DEFAULT_DEPS_OVERRIDES });
}

// ── complete ─────────────────────────────────────────────────────────────────────

describe('LLMService.complete', () => {
  it('rejects an empty prompt without calling the provider', async () => {
    let called = false;
    const service = makeService(async () => {
      called = true;
      return { content: 'unused' };
    });

    await assert.rejects(
      () => service.complete('   '),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.INVALID_INPUT);
        return true;
      },
    );
    assert.equal(called, false);
  });

  it('sends the prompt as a single user message and returns the text', async () => {
    let capturedParams: LLMProviderCompletionParams | undefined;
    const service = makeService(async (params) => {
      capturedParams = params;
      return { content: 'Hello there!' };
    });

    const result = await service.complete('Say hello');

    assert.equal(result, 'Hello there!');
    assert.deepEqual(capturedParams, {
      model: 'fake-model',
      messages: [{ role: 'user', content: 'Say hello' }],
      temperature: 0.7,
      maxOutputTokens: 1024,
    });
  });

  it('lets per-call options override the configured defaults', async () => {
    let capturedParams: LLMProviderCompletionParams | undefined;
    const service = makeService(async (params) => {
      capturedParams = params;
      return { content: 'ok' };
    });

    await service.complete('hi', { model: 'other-model', temperature: 0.2, maxOutputTokens: 64 });

    assert.equal(capturedParams?.model, 'other-model');
    assert.equal(capturedParams?.temperature, 0.2);
    assert.equal(capturedParams?.maxOutputTokens, 64);
  });
});

// ── chat ─────────────────────────────────────────────────────────────────────────

describe('LLMService.chat', () => {
  it('rejects an empty messages array', async () => {
    const service = makeService(async () => ({ content: 'unused' }));

    await assert.rejects(
      () => service.chat([]),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.INVALID_INPUT);
        return true;
      },
    );
  });

  it('rejects a message with empty content', async () => {
    const service = makeService(async () => ({ content: 'unused' }));

    await assert.rejects(
      () => service.chat([{ role: 'user', content: '  ' }]),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.INVALID_INPUT);
        return true;
      },
    );
  });

  it('forwards a multi-turn conversation as-is', async () => {
    let capturedMessages: LLMProviderCompletionParams['messages'] | undefined;
    const service = makeService(async (params) => {
      capturedMessages = params.messages;
      return { content: 'answer' };
    });

    const messages = [
      { role: 'system' as const, content: 'You are a helpful tutor.' },
      { role: 'user' as const, content: 'Explain phrasal verbs.' },
    ];
    const result = await service.chat(messages);

    assert.equal(result, 'answer');
    assert.deepEqual(capturedMessages, messages);
  });

  it('throws EMPTY_RESPONSE when the provider returns no content', async () => {
    const service = makeService(async () => ({ content: '' }));

    await assert.rejects(
      () => service.chat([{ role: 'user', content: 'hi' }]),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.EMPTY_RESPONSE);
        return true;
      },
    );
  });

  it('propagates errors thrown by the provider unchanged', async () => {
    const providerError = new LLMServiceError('boom', LLMErrorCode.RATE_LIMITED);
    const service = makeService(async () => {
      throw providerError;
    });

    await assert.rejects(() => service.chat([{ role: 'user', content: 'hi' }]), providerError);
  });
});

// ── completeStructured ──────────────────────────────────────────────────────────

describe('LLMService.completeStructured', () => {
  it('forwards the schema and timeout to the provider', async () => {
    let capturedParams: LLMProviderStructuredCompletionParams | undefined;
    const service = makeStructuredService(async (params) => {
      capturedParams = params;
      return { content: '{"ok":true}' };
    });

    await service.completeStructured([{ role: 'user', content: 'hi' }], {
      responseSchema: FAKE_SCHEMA,
      timeoutMs: 5000,
    });

    assert.equal(capturedParams?.responseSchema, FAKE_SCHEMA);
    assert.equal(capturedParams?.timeoutMs, 5000);
    assert.equal(capturedParams?.model, 'fake-model');
  });

  it('parses valid JSON content into a value', async () => {
    const service = makeStructuredService(async () => ({ content: '{"front":"iron out"}' }));

    const result = await service.completeStructured([{ role: 'user', content: 'hi' }], {
      responseSchema: FAKE_SCHEMA,
    });

    assert.deepEqual(result, { front: 'iron out' });
  });

  it('throws EMPTY_RESPONSE when the provider returns no content', async () => {
    const service = makeStructuredService(async () => ({ content: '' }));

    await assert.rejects(
      () =>
        service.completeStructured([{ role: 'user', content: 'hi' }], {
          responseSchema: FAKE_SCHEMA,
        }),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.EMPTY_RESPONSE);
        return true;
      },
    );
  });

  it('throws INVALID_JSON_RESPONSE when the provider returns malformed JSON', async () => {
    const service = makeStructuredService(async () => ({ content: '{not json' }));

    await assert.rejects(
      () =>
        service.completeStructured([{ role: 'user', content: 'hi' }], {
          responseSchema: FAKE_SCHEMA,
        }),
      (err: unknown) => {
        assert.ok(err instanceof LLMServiceError);
        assert.equal(err.code, LLMErrorCode.INVALID_JSON_RESPONSE);
        return true;
      },
    );
  });

  it('propagates errors thrown by the provider unchanged', async () => {
    const providerError = new LLMServiceError('boom', LLMErrorCode.TIMEOUT);
    const service = makeStructuredService(async () => {
      throw providerError;
    });

    await assert.rejects(
      () =>
        service.completeStructured([{ role: 'user', content: 'hi' }], {
          responseSchema: FAKE_SCHEMA,
        }),
      providerError,
    );
  });
});
