import type { ListeningSourceSafeDto } from '@repositories/mocks/listening-sources.repository';

/** One part inside a grouped Listening test (same YouTube video). */
export interface ListeningTestPartSummaryDto {
  sourceId: string;
  partCode: string;
  title: string;
  instructions: string;
  itemCount: number;
  videoStartSeconds: number;
  videoEndSeconds: number;
}

/**
 * One curated Listening paper = N active sources that share `videoExternalId`
 * (normally the 4 LISTENING_PART_1..4 rows for that YouTube test).
 */
export interface ListeningTestGroupDto {
  /** Stable public id — the bare YouTube video id. */
  id: string;
  videoExternalId: string;
  videoProvider: string;
  examCode: string;
  paperCode: string;
  title: string;
  targetLevel: ListeningSourceSafeDto['targetLevel'];
  partCount: number;
  totalItemCount: number;
  parts: ListeningTestPartSummaryDto[];
  createdAt: Date;
}

const PART_ORDER = [
  'LISTENING_PART_1',
  'LISTENING_PART_2',
  'LISTENING_PART_3',
  'LISTENING_PART_4',
] as const;

function partSortKey(partCode: string): number {
  const idx = PART_ORDER.indexOf(partCode as (typeof PART_ORDER)[number]);
  return idx === -1 ? 999 : idx;
}

/** "B2 First Listening — Test 1 Part 2" → "B2 First Listening — Test 1" */
export function deriveListeningTestTitle(partTitles: string[]): string {
  const first = partTitles[0]?.trim() || 'Listening test';
  const stripped = first
    .replace(/\s*[—–-]\s*Part\s*\d+\s*$/i, '')
    .replace(/\s+Part\s*\d+\s*$/i, '')
    .trim();
  return stripped.length > 0 ? stripped : first;
}

export function groupListeningSourcesIntoTests(
  sources: ListeningSourceSafeDto[],
): ListeningTestGroupDto[] {
  const byVideo = new Map<string, ListeningSourceSafeDto[]>();

  for (const source of sources) {
    const key = source.videoExternalId;
    const bucket = byVideo.get(key);
    if (bucket) bucket.push(source);
    else byVideo.set(key, [source]);
  }

  const tests: ListeningTestGroupDto[] = [];

  for (const [videoExternalId, parts] of byVideo) {
    const ordered = [...parts].sort(
      (a, b) => partSortKey(a.partCode) - partSortKey(b.partCode),
    );
    const first = ordered[0]!;
    tests.push({
      id: videoExternalId,
      videoExternalId,
      videoProvider: first.videoProvider,
      examCode: first.examCode,
      paperCode: first.paperCode,
      title: deriveListeningTestTitle(ordered.map((p) => p.title)),
      targetLevel: first.targetLevel,
      partCount: ordered.length,
      totalItemCount: ordered.reduce((sum, p) => sum + p.itemCount, 0),
      parts: ordered.map((p) => ({
        sourceId: p.id,
        partCode: p.partCode,
        title: p.title,
        instructions: p.instructions,
        itemCount: p.itemCount,
        videoStartSeconds: p.videoStartSeconds,
        videoEndSeconds: p.videoEndSeconds,
      })),
      createdAt: first.createdAt,
    });
  }

  return tests.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
