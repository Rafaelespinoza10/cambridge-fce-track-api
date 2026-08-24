import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { getCurrentWeekBounds, getLastNWeekStarts, calculateStreak } from './progress-library';

describe('getCurrentWeekBounds — America/Mexico_City (UTC-6, no DST)', () => {
  it('keeps a Sunday-evening instant in the week that is ending, not next week', () => {
    // 2026-01-04 19:00 in Mexico City (a Sunday) is 2026-01-05 01:00 UTC — already
    // Monday in UTC. The old getUTCDay()-based logic read that as the START of a
    // new week, so an activity logged that evening vanished from "This Week".
    const now = new Date('2026-01-05T01:00:00.000Z');

    const bounds = getCurrentWeekBounds('America/Mexico_City', now);

    assert.deepEqual(bounds, { weekStart: '2025-12-29', weekEnd: '2026-01-04' });
  });

  it('the same instant read as plain UTC lands in the wrong (next) week — demonstrates the bug this replaces', () => {
    const now = new Date('2026-01-05T01:00:00.000Z');

    const bounds = getCurrentWeekBounds('UTC', now);

    assert.deepEqual(bounds, { weekStart: '2026-01-05', weekEnd: '2026-01-11' });
  });

  it('a Monday-morning instant in Mexico City resolves to that same week', () => {
    // 2026-01-05 08:00 Mexico City = 2026-01-05 14:00 UTC.
    const now = new Date('2026-01-05T14:00:00.000Z');

    const bounds = getCurrentWeekBounds('America/Mexico_City', now);

    assert.deepEqual(bounds, { weekStart: '2026-01-05', weekEnd: '2026-01-11' });
  });
});

describe('getCurrentWeekBounds — UTC', () => {
  it('a Sunday resolves as the last day of the current week', () => {
    const now = new Date('2026-01-04T12:00:00.000Z');

    const bounds = getCurrentWeekBounds('UTC', now);

    assert.deepEqual(bounds, { weekStart: '2025-12-29', weekEnd: '2026-01-04' });
  });
});

describe('getLastNWeekStarts', () => {
  it('returns n consecutive Monday keys ending at the current week', () => {
    const now = new Date('2026-01-05T01:00:00.000Z');

    const starts = getLastNWeekStarts(4, 'America/Mexico_City', now);

    assert.deepEqual(starts, ['2025-12-08', '2025-12-15', '2025-12-22', '2025-12-29']);
  });
});

describe('calculateStreak — America/Mexico_City', () => {
  it('counts a study session logged this evening as today, extending the streak', () => {
    // Same evening-rollover instant as above: 19:00 Mexico City, already
    // tomorrow in UTC. studyDates come from a timezone-aware SQL query, so
    // they're already correct local date keys — today/yesterday must match.
    const now = new Date('2026-01-05T01:00:00.000Z');
    const studyDates = ['2026-01-04', '2026-01-03', '2026-01-02'];

    const streak = calculateStreak(studyDates, 'America/Mexico_City', now);

    assert.equal(streak, 3);
  });

  it('returns 0 when the most recent study date is neither today nor yesterday', () => {
    const now = new Date('2026-01-05T01:00:00.000Z');
    const studyDates = ['2026-01-01'];

    const streak = calculateStreak(studyDates, 'America/Mexico_City', now);

    assert.equal(streak, 0);
  });

  it('returns 0 for an empty study date list', () => {
    assert.equal(calculateStreak([], 'America/Mexico_City'), 0);
  });
});
