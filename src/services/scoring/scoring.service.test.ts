import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { deriveFallbackPercentage } from './scoring.service';

describe('deriveFallbackPercentage', () => {
  it('computes a percentage from rawScore/maxScore', () => {
    assert.equal(deriveFallbackPercentage(8, 10), 80);
  });

  it('rounds to two decimals', () => {
    assert.equal(deriveFallbackPercentage(1, 3), 33.33);
  });

  it('returns null when rawScore is missing', () => {
    assert.equal(deriveFallbackPercentage(null, 10), null);
  });

  it('returns null when maxScore is missing', () => {
    assert.equal(deriveFallbackPercentage(8, null), null);
  });

  it('returns null when maxScore is zero', () => {
    assert.equal(deriveFallbackPercentage(8, 0), null);
  });

  it('returns null when maxScore is negative', () => {
    assert.equal(deriveFallbackPercentage(8, -10), null);
  });

  it('allows a rawScore of zero', () => {
    assert.equal(deriveFallbackPercentage(0, 10), 0);
  });
});
