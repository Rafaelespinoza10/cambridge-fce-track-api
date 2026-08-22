/**
 * Strips repeated headers/footers from extracted PDF pages (e.g. "Cambridge
 * English: First for Schools", "© UCLES 2023", running page numbers).
 * Deliberately conservative — only removes a line when ALL of these hold:
 *
 *  1. It sits in the header zone (first EDGE_ZONE_LINES lines) or footer
 *     zone (last EDGE_ZONE_LINES lines) of a page — real exercises, rules
 *     and examples never live exclusively in a 2-line margin.
 *  2. It's short (<= MAX_BOILERPLATE_LINE_LENGTH chars) — question stems,
 *     instructions and examples always run longer than a running header.
 *  3. Its normalized form (trimmed, lowercased, digits collapsed to "#" so
 *     page numbers don't defeat the match) repeats across at least
 *     MIN_BOILERPLATE_RATIO of the document's pages.
 *
 * Any line that fails one of these is left untouched — the bias is toward
 * under-cleaning (a stray footer surviving into a chunk) over over-cleaning
 * (losing a real exercise/rule/example), per the "no perder ejercicios..."
 * requirement.
 */

const EDGE_ZONE_LINES = 2;
const MAX_BOILERPLATE_LINE_LENGTH = 80;
const MIN_BOILERPLATE_RATIO = 0.5;
const MIN_PAGES_FOR_DETECTION = 3;

function normalizeLine(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ');
}

function edgeCandidateLines(lines: string[]): Set<number> {
  const candidates = new Set<number>();
  for (let i = 0; i < Math.min(EDGE_ZONE_LINES, lines.length); i++) candidates.add(i);
  for (let i = Math.max(0, lines.length - EDGE_ZONE_LINES); i < lines.length; i++) {
    candidates.add(i);
  }
  return candidates;
}

/** Pure function: pages in, cleaned pages out — same length/order, never touches page numbering. */
export function stripRepeatedHeadersAndFooters(pages: readonly string[]): string[] {
  if (pages.length < MIN_PAGES_FOR_DETECTION) return [...pages];

  const boilerplateCounts = new Map<string, number>();
  const perPageLines = pages.map((page) => page.split('\n'));

  for (const lines of perPageLines) {
    const candidateIndexes = edgeCandidateLines(lines);
    const seenOnThisPage = new Set<string>();
    for (const index of candidateIndexes) {
      const raw = lines[index];
      if (raw.length === 0 || raw.length > MAX_BOILERPLATE_LINE_LENGTH) continue;
      const normalized = normalizeLine(raw);
      if (normalized === '' || seenOnThisPage.has(normalized)) continue;
      seenOnThisPage.add(normalized);
      boilerplateCounts.set(normalized, (boilerplateCounts.get(normalized) ?? 0) + 1);
    }
  }

  const minOccurrences = Math.ceil(pages.length * MIN_BOILERPLATE_RATIO);
  const boilerplate = new Set(
    [...boilerplateCounts.entries()]
      .filter(([, count]) => count >= minOccurrences)
      .map(([normalized]) => normalized),
  );
  if (boilerplate.size === 0) return [...pages];

  return perPageLines.map((lines) => {
    const candidateIndexes = edgeCandidateLines(lines);
    return lines
      .filter((raw, index) => {
        if (!candidateIndexes.has(index)) return true;
        if (raw.length === 0 || raw.length > MAX_BOILERPLATE_LINE_LENGTH) return true;
        return !boilerplate.has(normalizeLine(raw));
      })
      .join('\n');
  });
}
