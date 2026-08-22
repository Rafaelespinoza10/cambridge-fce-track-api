import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';

import { resolveUserLocalDayKey } from './resolve-user-local-day';

const USER_ID = '11111111-1111-1111-1111-111111111111';

/** 2026-01-01T02:00:00Z — still 2025-12-31 anywhere west of UTC-3. */
const LATE_NIGHT_UTC = new Date('2026-01-01T02:00:00.000Z');

function makeManager(timezone: string | null, profileExists = true): EntityManager {
  return {
    getRepository: () => ({
      findOne: async () => (profileExists ? { timezone } : null),
    }),
  } as unknown as EntityManager;
}

describe('resolveUserLocalDayKey', () => {
  it("returns the user's local day, not the UTC day", async () => {
    const key = await resolveUserLocalDayKey(
      makeManager('America/Mexico_City'),
      USER_ID,
      LATE_NIGHT_UTC,
    );

    // 02:00 UTC on Jan 1 is 20:00 on Dec 31 in UTC-6. This is the whole bug:
    // the old `toISOString().slice(0, 10)` said '2026-01-01'.
    assert.equal(key, '2025-12-31');
  });

  it('agrees with the UTC day when the two do not diverge', async () => {
    const midday = new Date('2026-01-01T18:00:00.000Z');
    const key = await resolveUserLocalDayKey(makeManager('America/Mexico_City'), USER_ID, midday);

    assert.equal(key, '2026-01-01');
  });

  it('handles a positive offset, where local can be the NEXT day', async () => {
    const key = await resolveUserLocalDayKey(makeManager('Asia/Tokyo'), USER_ID, LATE_NIGHT_UTC);

    // UTC+9: 02:00 Jan 1 UTC is 11:00 Jan 1 local — same day here, but the
    // reverse case is what matters, so also check a pre-midnight instant.
    assert.equal(key, '2026-01-01');

    const eveningUtc = new Date('2025-12-31T16:00:00.000Z');
    const nextDay = await resolveUserLocalDayKey(makeManager('Asia/Tokyo'), USER_ID, eveningUtc);
    assert.equal(nextDay, '2026-01-01'); // 01:00 Jan 1 in Tokyo
  });

  it('respects DST rather than a fixed offset', async () => {
    // 2026-07-01 is CEST (UTC+2), not CET (UTC+1).
    const key = await resolveUserLocalDayKey(
      makeManager('Europe/Madrid'),
      USER_ID,
      new Date('2026-06-30T22:30:00.000Z'),
    );

    assert.equal(key, '2026-07-01'); // 00:30 local
  });

  it('falls back to UTC when the profile has no timezone', async () => {
    const key = await resolveUserLocalDayKey(makeManager(null), USER_ID, LATE_NIGHT_UTC);

    // Exactly the old behaviour — this fix is never a new kind of wrong.
    assert.equal(key, '2026-01-01');
  });

  it('falls back to UTC when there is no profile row at all', async () => {
    const key = await resolveUserLocalDayKey(makeManager(null, false), USER_ID, LATE_NIGHT_UTC);

    assert.equal(key, '2026-01-01');
  });

  it('falls back to UTC on a garbage stored timezone instead of throwing', async () => {
    // Unlike session generation, this runs inside an already-graded
    // submission's transaction — aborting it after the LLM was paid for
    // would be worse than placing the activity on the UTC day.
    const key = await resolveUserLocalDayKey(
      makeManager('Not/AZone'),
      USER_ID,
      LATE_NIGHT_UTC,
    );

    assert.equal(key, '2026-01-01');
  });
});
