export function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

export function getCurrentWeekBounds(): { weekStart: string; weekEnd: string } {
  const today = new Date();
  const day = today.getUTCDay();
  const daysToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    weekStart: monday.toISOString().split('T')[0]!,
    weekEnd: sunday.toISOString().split('T')[0]!,
  };
}

export function getLastNWeekStarts(n: number): string[] {
  const { weekStart } = getCurrentWeekBounds();
  const starts: string[] = [];

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() - i * 7);
    starts.push(d.toISOString().split('T')[0]!);
  }

  return starts;
}

export function calculateStreak(sortedDatesDesc: string[]): number {
  if (sortedDatesDesc.length === 0) return 0;

  const todayStr = new Date().toISOString().split('T')[0]!;
  const yesterdayStr = (() => {
    const d = new Date();
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
