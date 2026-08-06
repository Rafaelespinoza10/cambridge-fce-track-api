import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  FlashcardDraftGenerator,
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from './flashcard-draft-generator';
import type { LLMServicePort, PracticeErrorDraftContext } from './flashcard-draft-generator';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import { FlashcardType, EnglishLevel } from '../../models/enums';

const VALID_RAW_DRAFT = {
  type: 'grammar',
  front: 'Which preposition follows "depend"?',
  back: 'depend on',
  translation: 'depender de',
  example: 'Your progress depends on consistent practice.',
  personalExample: 'My Cambridge progress depends on studying every day.',
  notes: 'Use "depend on", not "depend of".',
  sourceName: null,
  sourceUrl: null,
  level: 'B1',
  tags: ['dependent-prepositions', 'grammar', 'use-of-english'],
};

const CONTEXT: PracticeErrorDraftContext = {
  examCode: 'B2_FIRST',
  paperCode: 'PAPER_1',
  partCode: 'UOE_PART_1',
  taskType: 'multiple_choice_cloze',
  prompt: 'Your success depends ___ hard work.',
  stimulus: null,
  options: 'A) of  B) on  C) in  D) at',
  userAnswer: 'of',
  correctAnswer: 'on',
  explanation: '"Depend" is always followed by the preposition "on".',
  skillTags: ['prepositions', 'use-of-english'],
  targetLevel: EnglishLevel.B1,
};

function makeGenerator(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
): FlashcardDraftGenerator {
  const llm: LLMServicePort = { completeStructured };
  return new FlashcardDraftGenerator({ llm });
}

function assertGenerationError(err: unknown, code: FlashcardDraftGenerationErrorCode): true {
  assert.ok(err instanceof FlashcardDraftGenerationError);
  assert.equal(err.code, code);
  return true;
}

// ── generateFromPracticeError — happy path ──────────────────────────────────────

describe('FlashcardDraftGenerator.generateFromPracticeError — happy path', () => {
  it('returns a fully-shaped draft from a well-formed model response', async () => {
    const generator = makeGenerator(async () => VALID_RAW_DRAFT);
    const result = await generator.generateFromPracticeError(CONTEXT);
    assert.deepEqual(result, VALID_RAW_DRAFT);
  });

  it('accepts any real FlashcardType — no expectedType is enforced (the model picks)', async () => {
    const generator = makeGenerator(async () => ({ ...VALID_RAW_DRAFT, type: 'phrasal_verb' }));
    const result = await generator.generateFromPracticeError(CONTEXT);
    assert.equal(result.type, FlashcardType.PHRASAL_VERB);
  });

  it('sends a system prompt and a JSON Schema Structured Outputs request', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    let capturedOptions: LLMStructuredCompletionOptions | undefined;
    const generator = makeGenerator(async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return VALID_RAW_DRAFT;
    });

    await generator.generateFromPracticeError(CONTEXT);

    assert.equal(capturedMessages?.[0]?.role, 'system');
    assert.equal(capturedMessages?.[1]?.role, 'user');
    assert.equal(capturedOptions?.responseSchema.name, 'flashcard_draft');
    assert.equal(capturedOptions?.responseSchema.strict, true);
    assert.ok((capturedOptions?.timeoutMs ?? 0) > 0);
  });

  it('the user prompt includes the practice-error context fields', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    const generator = makeGenerator(async (messages) => {
      capturedMessages = messages;
      return VALID_RAW_DRAFT;
    });

    await generator.generateFromPracticeError(CONTEXT);

    const userContent = capturedMessages?.[1]?.content ?? '';
    assert.match(userContent, /B2_FIRST/);
    assert.match(userContent, /PAPER_1/);
    assert.match(userContent, /UOE_PART_1/);
    assert.match(userContent, /multiple_choice_cloze/);
    assert.match(userContent, /Your success depends ___ hard work\./);
    assert.match(userContent, /A\) of {2}B\) on {2}C\) in {2}D\) at/);
    assert.match(userContent, /\bof\b/); // user's answer
    assert.match(userContent, /\bon\b/); // correct answer
    assert.match(userContent, /always followed by the preposition/);
    assert.match(userContent, /prepositions, use-of-english/);
    assert.match(userContent, /B1/);
  });

  it('renders sensible fallback text for null/empty optional context fields', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    const generator = makeGenerator(async (messages) => {
      capturedMessages = messages;
      return VALID_RAW_DRAFT;
    });

    await generator.generateFromPracticeError({
      ...CONTEXT,
      stimulus: null,
      options: null,
      explanation: null,
      skillTags: [],
      targetLevel: null,
    });

    const userContent = capturedMessages?.[1]?.content ?? '';
    assert.match(userContent, /\(not applicable\)/);
    assert.match(userContent, /\(none provided\)/);
  });

  it('never sends userId, JWT, or other internal identifiers in the prompt', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    const generator = makeGenerator(async (messages) => {
      capturedMessages = messages;
      return VALID_RAW_DRAFT;
    });

    await generator.generateFromPracticeError(CONTEXT);

    const fullText = capturedMessages?.map((m) => m.content).join('\n') ?? '';
    assert.doesNotMatch(fullText, /userId|user_id|Bearer |eyJ|attemptId|itemId/i);
  });
});

// ── generateFromPracticeError — response validation (shared with the term flow) ──

describe('FlashcardDraftGenerator.generateFromPracticeError — response validation', () => {
  it('rejects a response missing required fields', async () => {
    const generator = makeGenerator(async () => ({ type: 'grammar', front: 'depend' }));
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a type value hallucinated by the model (not a real enum member)', async () => {
    const generator = makeGenerator(async () => ({ ...VALID_RAW_DRAFT, type: 'made_up_type' }));
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a non-null sourceName/sourceUrl', async () => {
    const generator = makeGenerator(async () => ({ ...VALID_RAW_DRAFT, sourceName: 'Cambridge' }));
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('dedupes and lowercases duplicate tags returned by the model', async () => {
    const generator = makeGenerator(async () => ({
      ...VALID_RAW_DRAFT,
      tags: ['Grammar', 'grammar', 'GRAMMAR', 'Prepositions'],
    }));
    const result = await generator.generateFromPracticeError(CONTEXT);
    assert.deepEqual(result.tags, ['grammar', 'prepositions']);
  });

  it('rejects more than 20 tags', async () => {
    const generator = makeGenerator(async () => ({
      ...VALID_RAW_DRAFT,
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    }));
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects an invalid level', async () => {
    const generator = makeGenerator(async () => ({ ...VALID_RAW_DRAFT, level: 'Z9' }));
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a front that exceeds 500 characters', async () => {
    const generator = makeGenerator(async () => ({ ...VALID_RAW_DRAFT, front: 'a'.repeat(501) }));
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });
});

// ── generateFromPracticeError — provider failures ────────────────────────────────

describe('FlashcardDraftGenerator.generateFromPracticeError — provider failures', () => {
  it('maps a timeout to AI_REQUEST_TIMEOUT', async () => {
    const generator = makeGenerator(async () => {
      throw new LLMServiceError('OpenAI request timed out', LLMErrorCode.TIMEOUT);
    });
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT),
    );
  });

  it('maps a provider rate limit to AI_RATE_LIMITED', async () => {
    const generator = makeGenerator(async () => {
      throw new LLMServiceError('OpenAI rate limit exceeded', LLMErrorCode.RATE_LIMITED);
    });
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED),
    );
  });

  it('maps a missing API key to AI_CONFIGURATION_ERROR', async () => {
    const generator = makeGenerator(async () => {
      throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
    });
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR),
    );
  });

  it('maps a generic provider outage to AI_PROVIDER_UNAVAILABLE', async () => {
    const generator = makeGenerator(async () => {
      throw new LLMServiceError('OpenAI request failed: 503', LLMErrorCode.PROVIDER_ERROR);
    });
    await assert.rejects(
      () => generator.generateFromPracticeError(CONTEXT),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE),
    );
  });

  it('never leaks the raw provider error message', async () => {
    const generator = makeGenerator(async () => {
      throw new LLMServiceError(
        'OpenAI request failed: invoice #12345 over billing limit for org-abc',
        LLMErrorCode.PROVIDER_ERROR,
      );
    });
    try {
      await generator.generateFromPracticeError(CONTEXT);
      assert.fail('expected generateFromPracticeError() to reject');
    } catch (err) {
      assert.ok(err instanceof FlashcardDraftGenerationError);
      assert.doesNotMatch(err.message, /invoice|billing|org-abc/);
    }
  });
});

// ── generateFromTerm still works through the shared generator directly ──────────

describe('FlashcardDraftGenerator.generateFromTerm', () => {
  it('enforces expectedType — rejects a mismatched type from the model', async () => {
    const generator = makeGenerator(async () => ({ ...VALID_RAW_DRAFT, type: 'vocabulary' }));
    await assert.rejects(
      () => generator.generateFromTerm('depend on', FlashcardType.GRAMMAR),
      (err: unknown) =>
        assertGenerationError(err, FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('returns a fully-shaped draft when the type matches', async () => {
    const generator = makeGenerator(async () => VALID_RAW_DRAFT);
    const result = await generator.generateFromTerm('depend on', FlashcardType.GRAMMAR);
    assert.deepEqual(result, VALID_RAW_DRAFT);
  });
});
