import { resolveLocalDay } from '@lib/shared/timezone';

export function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * The Monday..Sunday week containing the user's local "today", as
 * YYYY-MM-DD date keys.
 *
 * `now` is resolved to a local calendar date via `resolveLocalDay` first,
 * then all further arithmetic is done in UTC on the Y/M/D components alone
 * (never on a real instant) — the same safe pattern the frontend's
 * calendar-utils.ts and this file's own day-key arithmetic already use.
 * Previously this used `getUTCDay()`/`setUTCDate()` directly on `new Date()`,
 * i.e. the *server's* UTC calendar day: for a user west of Greenwich, that's
 * already tomorrow for several hours every evening, so an activity logged
 * that evening got queried against next week's bounds and silently
 * disappeared from "This Week" on Home.
 */
export function getCurrentWeekBounds(
  timeZone: string,
  now: Date = new Date(),
): { weekStart: string; weekEnd: string } {
  const { localDate } = resolveLocalDay(now, timeZone);
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];

  const today = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = today.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + daysToMonday);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekStart: monday.toISOString().split('T')[0]!,
    weekEnd: sunday.toISOString().split('T')[0]!,
  };
}

export function getLastNWeekStarts(n: number, timeZone: string, now: Date = new Date()): string[] {
  const { weekStart } = getCurrentWeekBounds(timeZone, now);
  const starts: string[] = [];

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() - i * 7);
    starts.push(d.toISOString().split('T')[0]!);
  }

  return starts;
}

/**
 * `sortedDatesDesc` are the user's local study-date keys (already resolved
 * with the user's timezone by the caller's SQL query). "Today"/"yesterday"
 * here must be resolved the same way, or a streak logged in the evening
 * (already tomorrow in UTC) reads as broken. See getCurrentWeekBounds.
 */
export function calculateStreak(
  sortedDatesDesc: string[],
  timeZone: string,
  now: Date = new Date(),
): number {
  if (sortedDatesDesc.length === 0) return 0;

  const todayStr = resolveLocalDay(now, timeZone).localDate;
  const yesterdayStr = (() => {
    const d = new Date(`${todayStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0]!;
  })();

  // Streak only counts if the user studied today or yesterday
  if (sortedDatesDesc[0] !== todayStr && sortedDatesDesc[0] !== yesterdayStr) return 0;

  let streak = 1;
  for (let i = 1; i < sortedDatesDesc.length; i++) {
    const prev = new Date(sortedDatesDesc[i - 1]!);
    const curr = new Date(sortedDatesDesc[i]!);
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
