// Cálculo puro de racha de flashcards a partir de fechas locales (YYYY-MM-DD)
// con daily_review_stats.goal_completed = true. No accede a DB ni al reloj del
// sistema — el caller resuelve "hoy" vía resolveLocalDay(now, timezone) y lo
// pasa explícitamente, para que el resultado sea determinista y testeable.

export interface StreakResult {
  current: number;
  best: number;
}

function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { year, month, day };
}

/** Diferencia en días de calendario entre dos fechas YYYY-MM-DD (b - a). */
function diffDays(a: string, b: string): number {
  const pa = parseDateString(a);
  const pb = parseDateString(b);
  const msA = Date.UTC(pa.year, pa.month - 1, pa.day);
  const msB = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((msB - msA) / 86_400_000);
}

/**
 * Suma (o resta) días de calendario a una fecha YYYY-MM-DD usando Date.UTC
 * como motor de aritmética de calendario puro (sin timezone real) — normaliza
 * automáticamente desbordes de mes/año y años bisiestos.
 */
function addDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateString(dateStr);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(result.getUTCFullYear()).padStart(4, '0');
  const m = String(result.getUTCMonth() + 1).padStart(2, '0');
  const d = String(result.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Racha actual y mejor racha histórica de días locales consecutivos
 * completados. `currentLocalDate` es el "hoy" del caller — nunca se infiere
 * internamente. Reglas:
 * - Si `currentLocalDate` está completado, la racha actual termina hoy.
 * - Si no, pero el día anterior sí lo está, la racha actual continúa
 *   provisionalmente hasta ayer.
 * - Si ni hoy ni ayer están completados, la racha actual es cero.
 * - La mejor racha es la corrida consecutiva más larga en todo el historial,
 *   independiente de si toca "hoy".
 */
export function calculateFlashcardStreak(
  completedDates: string[],
  currentLocalDate: string,
): StreakResult {
  const sorted = [...new Set(completedDates)].sort();

  if (sorted.length === 0) {
    return { current: 0, best: 0 };
  }

  const runLengthEndingAt: number[] = new Array(sorted.length);
  runLengthEndingAt[0] = 1;
  let best = 1;

  for (let i = 1; i < sorted.length; i++) {
    const consecutive = diffDays(sorted[i - 1]!, sorted[i]!) === 1;
    runLengthEndingAt[i] = consecutive ? runLengthEndingAt[i - 1]! + 1 : 1;
    best = Math.max(best, runLengthEndingAt[i]!);
  }

  const lastDate = sorted[sorted.length - 1]!;
  const yesterday = addDays(currentLocalDate, -1);

  let current = 0;
  if (lastDate === currentLocalDate || lastDate === yesterday) {
    current = runLengthEndingAt[sorted.length - 1]!;
  }

  return { current, best };
}
