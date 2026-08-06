import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  isPracticeItemOption,
  isPracticeItemOptionArray,
  isPracticeItemAnswerKey,
  isPracticeAnswerPayload,
  normalizeSkillTags,
  isSafeGenerationMetadata,
} from './practice-jsonb-validators';

// ── answer key ───────────────────────────────────────────────────────────────

describe('isPracticeItemAnswerKey', () => {
  it('accepts a valid single_choice answer key', () => {
    assert.equal(
      isPracticeItemAnswerKey({ kind: 'single_choice', acceptedOptionIds: ['opt-a'] }),
      true,
    );
  });

  it('accepts a valid text answer key', () => {
    assert.equal(
      isPracticeItemAnswerKey({
        kind: 'text',
        acceptedAnswers: ['answer'],
        caseSensitive: false,
      }),
      true,
    );
  });

  it('rejects a text answer key with an empty acceptedAnswers array', () => {
    assert.equal(
      isPracticeItemAnswerKey({ kind: 'text', acceptedAnswers: [], caseSensitive: false }),
      false,
    );
  });

  it('rejects a single_choice answer key with an empty acceptedOptionIds array', () => {
    assert.equal(isPracticeItemAnswerKey({ kind: 'single_choice', acceptedOptionIds: [] }), false);
  });

  it('rejects an unknown kind', () => {
    assert.equal(isPracticeItemAnswerKey({ kind: 'matching', pairs: [] }), false);
  });

  it('rejects a non-object value', () => {
    assert.equal(isPracticeItemAnswerKey('not an object'), false);
    assert.equal(isPracticeItemAnswerKey(null), false);
  });

  it('rejects a text answer key missing caseSensitive', () => {
    assert.equal(isPracticeItemAnswerKey({ kind: 'text', acceptedAnswers: ['a'] }), false);
  });
});

// ── answer payload ───────────────────────────────────────────────────────────

describe('isPracticeAnswerPayload', () => {
  it('accepts a valid single_choice payload', () => {
    assert.equal(isPracticeAnswerPayload({ kind: 'single_choice', optionId: 'opt-a' }), true);
  });

  it('accepts a valid text payload', () => {
    assert.equal(isPracticeAnswerPayload({ kind: 'text', value: 'answer' }), true);
  });

  it('rejects a payload with an unknown kind', () => {
    assert.equal(isPracticeAnswerPayload({ kind: 'multi_select', optionIds: [] }), false);
  });

  it('rejects a single_choice payload with a blank optionId', () => {
    assert.equal(isPracticeAnswerPayload({ kind: 'single_choice', optionId: '  ' }), false);
  });
});

// ── options ──────────────────────────────────────────────────────────────────

describe('isPracticeItemOption / isPracticeItemOptionArray', () => {
  it('accepts a valid option', () => {
    assert.equal(isPracticeItemOption({ id: 'opt-a', label: 'Option A' }), true);
  });

  it('accepts a valid option array', () => {
    assert.equal(
      isPracticeItemOptionArray([
        { id: 'opt-a', label: 'Option A' },
        { id: 'opt-b', label: 'Option B' },
      ]),
      true,
    );
  });

  it('rejects duplicate option ids', () => {
    assert.equal(
      isPracticeItemOptionArray([
        { id: 'opt-a', label: 'Option A' },
        { id: 'opt-a', label: 'Option A (dup)' },
      ]),
      false,
    );
  });

  it('rejects an empty option array', () => {
    assert.equal(isPracticeItemOptionArray([]), false);
  });
});

// ── skill tags ───────────────────────────────────────────────────────────────

describe('normalizeSkillTags', () => {
  it('trims, lowercases and dedupes', () => {
    assert.deepEqual(normalizeSkillTags([' Grammar ', 'grammar', 'Vocabulary']), [
      'grammar',
      'vocabulary',
    ]);
  });

  it('drops blank and non-string entries', () => {
    assert.deepEqual(normalizeSkillTags(['  ', 42, 'grammar']), ['grammar']);
  });

  it('returns an empty array for non-array input', () => {
    assert.deepEqual(normalizeSkillTags(undefined), []);
  });
});

// ── generation metadata safety ──────────────────────────────────────────────

describe('isSafeGenerationMetadata', () => {
  it('accepts null', () => {
    assert.equal(isSafeGenerationMetadata(null), true);
  });

  it('accepts a plain metadata bag (provider/tokens/requestId/schemaVersion)', () => {
    assert.equal(
      isSafeGenerationMetadata({
        provider: 'openai',
        inputTokens: 120,
        outputTokens: 340,
        requestId: 'req_abc123',
        schemaVersion: '1',
      }),
      true,
    );
  });

  it('does not flag unrelated business fields', () => {
    assert.equal(isSafeGenerationMetadata({ provider: 'openai', anythingElse: true }), true);
  });

  it('rejects a bag containing an API key', () => {
    assert.equal(isSafeGenerationMetadata({ apiKey: 'sk-secret' }), false);
  });

  it('rejects a bag containing the full prompt', () => {
    assert.equal(isSafeGenerationMetadata({ prompt: 'full system prompt text' }), false);
  });

  it('rejects a bag containing raw provider headers', () => {
    assert.equal(isSafeGenerationMetadata({ headers: { authorization: 'Bearer x' } }), false);
  });

  it('rejects a non-object value', () => {
    assert.equal(isSafeGenerationMetadata('not an object'), false);
  });
});
