import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GenerateFlashcardDraftService,
  GenerateFlashcardDraftError,
  GenerateFlashcardDraftErrorCode,
} from './generate-flashcard-draft.service';
import type { LLMServicePort } from './generate-flashcard-draft.service';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import { FlashcardType } from '../../models/enums';

const VALID_RAW_DRAFT = {
  type: 'phrasal_verb',
  front: 'iron out',
  back: 'to resolve or remove difficulties, problems, or disagreements',
  translation: 'resolver, solucionar o limar diferencias',
  example: 'We need to iron out a few issues before releasing the application.',
  personalExample: 'I need to iron out the remaining bugs in my Cambridge tracker.',
  notes: 'Commonly used with problems, details, differences, and difficulties.',
  sourceName: null,
  sourceUrl: null,
  level: 'B2',
  tags: ['phrasal-verbs', 'problem-solving', 'work'],
};

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
): GenerateFlashcardDraftService {
  const llm: LLMServicePort = { completeStructured };
  return new GenerateFlashcardDraftService({ llm });
}

function assertDraftError(err: unknown, code: GenerateFlashcardDraftErrorCode): true {
  assert.ok(err instanceof GenerateFlashcardDraftError);
  assert.equal(err.code, code);
  return true;
}

// ── happy path ───────────────────────────────────────────────────────────────────

describe('GenerateFlashcardDraftService.execute — happy path', () => {
  it('returns a fully-shaped draft from a well-formed model response', async () => {
    const service = makeService(async () => VALID_RAW_DRAFT);

    const result = await service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB });

    assert.deepEqual(result, VALID_RAW_DRAFT);
  });

  it('sends a system prompt and a JSON Schema Structured Outputs request', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    let capturedOptions: LLMStructuredCompletionOptions | undefined;
    const service = makeService(async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return VALID_RAW_DRAFT;
    });

    await service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB });

    assert.equal(capturedMessages?.[0]?.role, 'system');
    assert.equal(capturedMessages?.[1]?.role, 'user');
    assert.equal(capturedOptions?.responseSchema.name, 'flashcard_draft');
    assert.equal(capturedOptions?.responseSchema.strict, true);
    assert.ok((capturedOptions?.timeoutMs ?? 0) > 0);
  });

  it('trims the term before sending it to the model', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    const service = makeService(async (messages) => {
      capturedMessages = messages;
      return VALID_RAW_DRAFT;
    });

    await service.execute({ term: '   iron out   ', type: FlashcardType.PHRASAL_VERB });

    assert.match(capturedMessages?.[1]?.content ?? '', /"iron out"/);
    assert.doesNotMatch(capturedMessages?.[1]?.content ?? '', /"   iron out   "/);
  });

  it('dedupes and lowercases duplicate tags returned by the model', async () => {
    const service = makeService(async () => ({
      ...VALID_RAW_DRAFT,
      tags: ['Work', 'work', 'WORK', 'Study'],
    }));

    const result = await service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB });

    assert.deepEqual(result.tags, ['work', 'study']);
  });
});

// ── request validation ──────────────────────────────────────────────────────────

describe('GenerateFlashcardDraftService.execute — request validation', () => {
  it('rejects an empty term without calling the provider', async () => {
    let called = false;
    const service = makeService(async () => {
      called = true;
      return VALID_RAW_DRAFT;
    });

    await assert.rejects(
      () => service.execute({ term: '   ', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.INVALID_INPUT),
    );
    assert.equal(called, false);
  });

  it('rejects a term over 200 characters', async () => {
    const service = makeService(async () => VALID_RAW_DRAFT);

    await assert.rejects(
      () => service.execute({ term: 'a'.repeat(201), type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a type outside the real FlashcardType enum', async () => {
    const service = makeService(async () => VALID_RAW_DRAFT);

    await assert.rejects(
      () =>
        service.execute({
          term: 'iron out',
          type: 'not_a_real_type' as unknown as FlashcardType,
        }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.INVALID_INPUT),
    );
  });
});

// ── response validation ─────────────────────────────────────────────────────────

describe('GenerateFlashcardDraftService.execute — response validation', () => {
  it('rejects a response missing required fields', async () => {
    const service = makeService(async () => ({ type: 'phrasal_verb', front: 'iron out' }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a type value hallucinated by the model (not a real enum member)', async () => {
    const service = makeService(async () => ({ ...VALID_RAW_DRAFT, type: 'made_up_type' }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a type that does not match the requested type', async () => {
    const service = makeService(async () => ({ ...VALID_RAW_DRAFT, type: 'vocabulary' }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a non-null sourceName', async () => {
    const service = makeService(async () => ({
      ...VALID_RAW_DRAFT,
      sourceName: 'Cambridge Dictionary',
    }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a non-null sourceUrl', async () => {
    const service = makeService(async () => ({
      ...VALID_RAW_DRAFT,
      sourceUrl: 'https://dictionary.cambridge.org/iron-out',
    }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects an invalid level', async () => {
    const service = makeService(async () => ({ ...VALID_RAW_DRAFT, level: 'Z9' }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects more than 20 tags', async () => {
    const service = makeService(async () => ({
      ...VALID_RAW_DRAFT,
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a front that exceeds 500 characters', async () => {
    const service = makeService(async () => ({ ...VALID_RAW_DRAFT, front: 'a'.repeat(501) }));

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a response that is not a JSON object (e.g. an array)', async () => {
    const service = makeService(async () => ['not', 'an', 'object']);

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });
});

// ── provider failures ───────────────────────────────────────────────────────────

describe('GenerateFlashcardDraftService.execute — provider failures', () => {
  it('maps an empty LLM response to AI_INVALID_RESPONSE', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError('LLM returned an empty response', LLMErrorCode.EMPTY_RESPONSE);
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('maps a timeout to AI_REQUEST_TIMEOUT', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError('OpenAI request timed out', LLMErrorCode.TIMEOUT);
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT),
    );
  });

  it('maps a provider rate limit to AI_RATE_LIMITED', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError('OpenAI rate limit exceeded', LLMErrorCode.RATE_LIMITED);
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) => assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_RATE_LIMITED),
    );
  });

  it('maps a missing API key to AI_CONFIGURATION_ERROR', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) =>
        assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR),
    );
  });

  it('maps a rejected API key (401 from the provider) to AI_CONFIGURATION_ERROR', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError(
        'OpenAI rejected the configured API key',
        LLMErrorCode.AUTHENTICATION_FAILED,
      );
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) =>
        assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR),
    );
  });

  it('maps a generic provider outage to AI_PROVIDER_UNAVAILABLE', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError('OpenAI request failed: 503', LLMErrorCode.PROVIDER_ERROR);
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) =>
        assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE),
    );
  });

  it('maps a completely unexpected (non-LLMServiceError) failure to AI_PROVIDER_UNAVAILABLE', async () => {
    const service = makeService(async () => {
      throw new Error('something nobody anticipated');
    });

    await assert.rejects(
      () => service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB }),
      (err: unknown) =>
        assertDraftError(err, GenerateFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE),
    );
  });

  it('never leaks the raw provider error message to the caller', async () => {
    const service = makeService(async () => {
      throw new LLMServiceError(
        'OpenAI request failed: invoice #12345 over billing limit for org-abc',
        LLMErrorCode.PROVIDER_ERROR,
      );
    });

    try {
      await service.execute({ term: 'iron out', type: FlashcardType.PHRASAL_VERB });
      assert.fail('expected execute() to reject');
    } catch (err) {
      assert.ok(err instanceof GenerateFlashcardDraftError);
      assert.doesNotMatch(err.message, /invoice|billing|org-abc/);
    }
  });
});
