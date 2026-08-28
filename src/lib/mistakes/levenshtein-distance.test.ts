import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { levenshteinDistance } from './levenshtein-distance';

describe('levenshteinDistance', () => {
  it('is 0 for identical strings', () => {
    assert.equal(levenshteinDistance('availability', 'availability'), 0);
  });

  it('is the length of the other string when one is empty', () => {
    assert.equal(levenshteinDistance('', 'abc'), 3);
    assert.equal(levenshteinDistance('abc', ''), 3);
  });

  it('counts a single substitution as distance 1', () => {
    assert.equal(levenshteinDistance('availability', 'availibility'), 1);
  });

  it('counts a single insertion as distance 1', () => {
    assert.equal(levenshteinDistance('environment', 'enviroment'), 1);
  });

  it('counts a single deletion as distance 1', () => {
    assert.equal(levenshteinDistance('enviroment', 'environment'), 1);
  });

  it('counts multiple edits correctly', () => {
    assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
  });
});
