import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { resolveLocalDay, isValidTimeZone } from './timezone';

const HOUR_MS = 60 * 60 * 1000;

describe('resolveLocalDay — UTC', () => {
  it('resolves the local date and a plain 24h day range', () => {
    const result = resolveLocalDay(new Date('2026-01-15T14:30:00.000Z'), 'UTC');

    assert.equal(result.localDate, '2026-01-15');
    assert.equal(result.dayStartedAt.toISOString(), '2026-01-15T00:00:00.000Z');
    assert.equal(result.dayEndedAt.toISOString(), '2026-01-16T00:00:00.000Z');
    assert.equal(result.dayEndedAt.getTime() - result.dayStartedAt.getTime(), 24 * HOUR_MS);
  });
});

describe('resolveLocalDay — America/Mexico_City (no DST, UTC-6)', () => {
  it('resolves a plain 24h day range', () => {
    const result = resolveLocalDay(new Date('2026-06-15T18:00:00.000Z'), 'America/Mexico_City');

    assert.equal(result.localDate, '2026-06-15');
    assert.equal(result.dayStartedAt.toISOString(), '2026-06-15T06:00:00.000Z');
    assert.equal(result.dayEndedAt.toISOString(), '2026-06-16T06:00:00.000Z');
    assert.equal(result.dayEndedAt.getTime() - result.dayStartedAt.getTime(), 24 * HOUR_MS);
  });

  it('resolves the correct local date near midnight (not off by one)', () => {
    // 2026-01-01T03:00:00Z is still 2025-12-31 22:00 in Mexico City (UTC-6).
    const result = resolveLocalDay(new Date('2026-01-01T03:00:00.000Z'), 'America/Mexico_City');

    assert.equal(result.localDate, '2025-12-31');
    assert.equal(result.dayStartedAt.toISOString(), '2025-12-31T06:00:00.000Z');
    assert.equal(result.dayEndedAt.toISOString(), '2026-01-01T06:00:00.000Z');
  });
});

describe('resolveLocalDay — DST transitions (America/New_York)', () => {
  it('a spring-forward local day is only 23 hours long', () => {
    // 2026-03-08: US clocks jump 02:00 -> 03:00 EST->EDT.
    const result = resolveLocalDay(new Date('2026-03-08T12:00:00.000Z'), 'America/New_York');

    assert.equal(result.localDate, '2026-03-08');
    assert.equal(result.dayStartedAt.toISOString(), '2026-03-08T05:00:00.000Z'); // 00:00 EST
    assert.equal(result.dayEndedAt.toISOString(), '2026-03-09T04:00:00.000Z'); // 00:00 EDT
    assert.equal(result.dayEndedAt.getTime() - result.dayStartedAt.getTime(), 23 * HOUR_MS);
  });

  it('a fall-back local day is 25 hours long', () => {
    // 2026-11-01: US clocks fall back 02:00 -> 01:00 EDT->EST.
    const result = resolveLocalDay(new Date('2026-11-01T12:00:00.000Z'), 'America/New_York');

    assert.equal(result.localDate, '2026-11-01');
    assert.equal(result.dayStartedAt.toISOString(), '2026-11-01T04:00:00.000Z'); // 00:00 EDT
    assert.equal(result.dayEndedAt.toISOString(), '2026-11-02T05:00:00.000Z'); // 00:00 EST
    assert.equal(result.dayEndedAt.getTime() - result.dayStartedAt.getTime(), 25 * HOUR_MS);
  });

  it('does not assume every day is 24 hours', () => {
    const springForward = resolveLocalDay(new Date('2026-03-08T12:00:00.000Z'), 'America/New_York');
    const ordinary = resolveLocalDay(new Date('2026-03-10T12:00:00.000Z'), 'America/New_York');

    assert.notEqual(
      springForward.dayEndedAt.getTime() - springForward.dayStartedAt.getTime(),
      24 * HOUR_MS,
    );
    assert.equal(ordinary.dayEndedAt.getTime() - ordinary.dayStartedAt.getTime(), 24 * HOUR_MS);
  });
});

describe('isValidTimeZone', () => {
  it('accepts a real IANA timezone', () => {
    assert.equal(isValidTimeZone('America/Lima'), true);
    assert.equal(isValidTimeZone('UTC'), true);
  });

  it('rejects a bogus timezone name', () => {
    assert.equal(isValidTimeZone('Not/A_Zone'), false);
    assert.equal(isValidTimeZone(''), false);
  });
});
