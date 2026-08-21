/**
 * Pure type guards for the Cambridge Knowledge Base's JSONB/array columns —
 * same role as lib/practice-jsonb-validators.ts, applied at the repository
 * boundary since Postgres cannot validate a JSONB/array column's internal
 * shape.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Keys that must never end up in cambridge_knowledge_items.metadata — a
// superset of practice-jsonb-validators's list, extended with the raw
// provider response fields the "Seguridad" requirement calls out by name.
const FORBIDDEN_METADATA_KEYS = new Set([
  'apiKey',
  'api_key',
  'authorization',
  'prompt',
  'systemPrompt',
  'system_prompt',
  'headers',
  'messages',
  'rawResponse',
  'raw_response',
  'response',
  'completion',
]);

/** Guards `cambridge_knowledge_items.metadata` against smuggling secrets, full prompts, or raw provider payloads. */
export function isSafeCambridgeMetadata(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => !FORBIDDEN_METADATA_KEYS.has(key));
}

/** A non-empty array of finite numbers — the only shape an embedding vector may take. */
export function isEmbeddingVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

/** Trims, drops blanks and dedupes a string array — used for both `skills` and `topics` before persistence. */
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}
