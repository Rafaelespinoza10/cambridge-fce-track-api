import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { LLMService } from './llm.service';
import { LLMServiceError, LLMErrorCode } from './llm.types';
import type { LLMProvider, LLMProviderCompletionParams, LLMProviderResult } from './llm.types';

const DEFAULT_DEPS_OVERRIDES = {
  defaultModel: 'fake-model',
  defaultTemperature: 0.7,
  defaultMaxOutputTokens: 1024,
};

function makeService(
  createCompletion: (params: LLMProviderCompletionParams) => Promise<LLMProviderResult>,
): LLMService {
  const provider: LLMProvider = {
    name: 'fake',
    defaultModel: 'fake-model',
    createCompletion,
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
