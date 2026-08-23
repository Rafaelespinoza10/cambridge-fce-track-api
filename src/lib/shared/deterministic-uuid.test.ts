import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { deterministicUuidFrom } from './deterministic-uuid';

const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicUuidFrom', () => {
  it('always returns the same uuid for the same input', () => {
    const a = deterministicUuidFrom('attempt-1:uoe-part-1');
    const b = deterministicUuidFrom('attempt-1:uoe-part-1');
    assert.equal(a, b);
  });

  it('returns a valid RFC 4122 v5-shaped uuid', () => {
    assert.match(deterministicUuidFrom('attempt-1:uoe-part-1'), UUID_V5_PATTERN);
    assert.match(deterministicUuidFrom(''), UUID_V5_PATTERN);
  });

  it('returns different uuids for different inputs', () => {
    const a = deterministicUuidFrom('attempt-1:uoe-part-1');
    const b = deterministicUuidFrom('attempt-1:uoe-part-2');
    const c = deterministicUuidFrom('attempt-2:uoe-part-1');
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(b, c);
  });
});
