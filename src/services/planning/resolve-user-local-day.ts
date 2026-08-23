import type { DataSource, EntityManager } from 'typeorm';
import { UserProfile } from '../../models/UserProfile';
import { resolveLocalDay, isValidTimeZone } from '@lib/shared/timezone';

/** Matches GenerateDailySessionService's fallback — a profile with no timezone behaves as it did before. */
const DEFAULT_TIMEZONE = 'UTC';

/**
 * The user's own calendar day for `instant`, as 'YYYY-MM-DD', ready to hand
 * to resolvePlanDayIdForDate.
 *
 * Exists because `instant.toISOString().slice(0, 10)` — which the Practice
 * and Writing submit paths used to do — is the UTC day, not the user's. For
 * anyone west of Greenwich those diverge every evening: a session finished at
 * 20:00 in America/Mexico_City is 02:00 UTC the NEXT day, so the activity
 * landed on tomorrow's plan day and vanished from "today" on the Plan screen.
 * GenerateDailySessionService already did this correctly via resolveLocalDay;
 * this is that same rule, extracted so all three AI-linked flows share it.
 *
 * An unset profile timezone falls back to UTC, i.e. exactly the old
 * behaviour — so this is only ever an improvement, never a new kind of wrong.
 * An invalid stored timezone also falls back rather than throwing: unlike
 * session generation (where the timezone IS the idempotency key and a bad
 * value must fail loudly), here it would abort an already-graded submission's
 * transaction after the LLM was paid for.
 */
export async function resolveUserLocalDayKey(
  manager: EntityManager,
  userId: string,
  instant: Date,
): Promise<string> {
  const timezone = await getUserTimeZone(manager, userId);
  return resolveLocalDay(instant, timezone).localDate;
}

/**
 * The user's IANA timezone, already validated, falling back to UTC.
 *
 * Separate from resolveUserLocalDayKey because SQL sometimes needs the zone
 * itself rather than one resolved day: the Progress metrics bucket instants
 * into days and weeks inside Postgres (`AT TIME ZONE $tz`), which can't be
 * expressed as a per-instant call from JS.
 *
 * Always returns a zone Postgres will accept: an unset or unparseable stored
 * value becomes 'UTC' rather than reaching a query, where a bad identifier
 * would raise `invalid value for parameter TimeZone` and fail the request.
 */
export async function getUserTimeZone(
  source: DataSource | EntityManager,
  userId: string,
): Promise<string> {
  const profile = await source
    .getRepository(UserProfile)
    .findOne({ where: { user_id: userId }, select: { timezone: true } });

  const stored = profile?.timezone ?? null;
  return stored !== null && isValidTimeZone(stored) ? stored : DEFAULT_TIMEZONE;
}
