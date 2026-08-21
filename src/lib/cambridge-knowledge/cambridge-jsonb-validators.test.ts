import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isSafeCambridgeMetadata,
  isEmbeddingVector,
  normalizeStringArray,
} from './cambridge-jsonb-validators';

describe('isSafeCambridgeMetadata', () => {
  it('accepts null', () => {
    assert.equal(isSafeCambridgeMetadata(null), true);
  });

  it('accepts a plain object with only benign keys', () => {
    assert.equal(
      isSafeCambridgeMetadata({ embeddingModel: 'text-embedding-3-small', chunkIndexInPage: 2 }),
      true,
    );
  });

  it('rejects a non-object value', () => {
    assert.equal(isSafeCambridgeMetadata('not an object'), false);
    assert.equal(isSafeCambridgeMetadata(42), false);
    assert.equal(isSafeCambridgeMetadata(['array']), false);
  });

  it('rejects metadata carrying an API key', () => {
    assert.equal(isSafeCambridgeMetadata({ apiKey: 'sk-secret' }), false);
  });

  it('rejects metadata carrying a full prompt', () => {
    assert.equal(isSafeCambridgeMetadata({ prompt: 'classify this...' }), false);
    assert.equal(isSafeCambridgeMetadata({ systemPrompt: 'you are a classifier' }), false);
  });

  it('rejects metadata carrying a raw provider response', () => {
    assert.equal(isSafeCambridgeMetadata({ rawResponse: '{"choices":[]}' }), false);
    assert.equal(isSafeCambridgeMetadata({ response: 'raw text' }), false);
  });
});

describe('isEmbeddingVector', () => {
  it('accepts a non-empty array of finite numbers', () => {
    assert.equal(isEmbeddingVector([0.1, -0.2, 0.3]), true);
  });

  it('rejects an empty array', () => {
    assert.equal(isEmbeddingVector([]), false);
  });

  it('rejects an array containing a non-number', () => {
    assert.equal(isEmbeddingVector([0.1, 'oops', 0.3]), false);
  });

  it('rejects an array containing NaN/Infinity', () => {
    assert.equal(isEmbeddingVector([0.1, NaN, 0.3]), false);
    assert.equal(isEmbeddingVector([0.1, Infinity, 0.3]), false);
  });

  it('rejects a non-array value', () => {
    assert.equal(isEmbeddingVector('not an array'), false);
    assert.equal(isEmbeddingVector(null), false);
  });
});

describe('normalizeStringArray', () => {
  it('trims, drops blanks and dedupes', () => {
    assert.deepEqual(normalizeStringArray([' reading ', 'reading', '', '  ', 'writing']), [
      'reading',
      'writing',
    ]);
  });

  it('drops non-string entries', () => {
    assert.deepEqual(normalizeStringArray(['reading', 42, null, 'writing']), [
      'reading',
      'writing',
    ]);
  });

  it('returns an empty array for a non-array input', () => {
    assert.deepEqual(normalizeStringArray('not an array'), []);
    assert.deepEqual(normalizeStringArray(null), []);
  });
});
