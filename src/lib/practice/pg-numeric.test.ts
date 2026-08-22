import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { toNullableNumber, toRequiredNumber } from './pg-numeric';

describe('toNullableNumber', () => {
  it('converts a numeric-looking string to a number', () => {
    const result = toNullableNumber('75.50');
    assert.equal(typeof result, 'number');
    assert.equal(result, 75.5);
  });

  it('leaves an already-numeric value as a number', () => {
    const result = toNullableNumber(42);
    assert.equal(typeof result, 'number');
    assert.equal(result, 42);
  });

  it('preserves null as null, never 0 or NaN', () => {
    const result = toNullableNumber(null);
    assert.equal(result, null);
  });

  it('converts "0" to the number 0, not null', () => {
    const result = toNullableNumber('0');
    assert.equal(typeof result, 'number');
    assert.equal(result, 0);
  });
});

describe('toRequiredNumber', () => {
  it('converts a numeric-looking string to a number', () => {
    const result = toRequiredNumber('8');
    assert.equal(typeof result, 'number');
    assert.equal(result, 8);
  });

  it('leaves an already-numeric value as a number', () => {
    const result = toRequiredNumber(8);
    assert.equal(typeof result, 'number');
    assert.equal(result, 8);
  });
});
