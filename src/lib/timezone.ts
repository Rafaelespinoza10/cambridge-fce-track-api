// Resolución pura de "día local" a partir de un instante UTC y un timezone IANA.
// Usa solo Intl.DateTimeFormat (disponible en el runtime de Node) — no se agrega
// ninguna dependencia de fechas porque la plataforma estándar ya alcanza para
// resolver correctamente conversiones de zona horaria, incluyendo DST.

export interface LocalDay {
  /** YYYY-MM-DD en la zona horaria dada. */
  localDate: string;
  /** Instante UTC de la medianoche local de ese día (inclusive). */
  dayStartedAt: Date;
  /** Instante UTC de la medianoche local del día siguiente (exclusive). */
  dayEndedAt: Date;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // h23 no debería producir '24', pero se normaliza por si el runtime lo hiciera.
    hour: map.hour === '24' ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function partsToUtcMs(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * Instante UTC correspondiente a un reloj de pared (Y,M,D,h,m,s) interpretado en
 * `timeZone`. Converge por iteración de punto fijo: el offset de la zona en el
 * instante candidato puede diferir del offset real cerca de una transición DST,
 * así que se recalcula hasta estabilizar (2 iteraciones bastan en la práctica).
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = target;

  for (let i = 0; i < 2; i++) {
    const zonedAsUtc = partsToUtcMs(getZonedParts(new Date(candidate), timeZone));
    const offset = zonedAsUtc - candidate;
    const next = target - offset;
    if (next === candidate) break;
    candidate = next;
  }

  return new Date(candidate);
}

export function resolveLocalDay(requestedAt: Date, timeZone: string): LocalDay {
  const parts = getZonedParts(requestedAt, timeZone);
  const localDate = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

  const dayStartedAt = zonedWallTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);

  // Aritmética de calendario en UTC solo sobre los componentes Y/M/D (no sobre el
  // instante), para obtener la fecha siguiente sin asumir que el día dura 24h.
  const nextCalendarDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const dayEndedAt = zonedWallTimeToUtc(
    nextCalendarDay.getUTCFullYear(),
    nextCalendarDay.getUTCMonth() + 1,
    nextCalendarDay.getUTCDate(),
    0,
    0,
    0,
    timeZone,
  );

  return { localDate, dayStartedAt, dayEndedAt };
}
