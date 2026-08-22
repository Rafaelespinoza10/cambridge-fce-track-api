import type {
  DailySessionItemOption,
  DailySessionItemAnswerKey,
  DailySessionAnswerPayload,
  DailySessionSentenceTarget,
} from '@models/daily-session-json-types';

/**
 * Pure type guards for the JSONB columns on the Daily Session entities.
 * Postgres cannot validate a JSONB column's internal shape, so repositories
 * must run these before persisting anything — this is the only schema
 * enforcement those columns get. Mirrors practice-jsonb-validators.ts
 * (deliberately not imported from it — see the domain-isolation note on
 * daily-session-json-types.ts).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isDailySessionItemOption(value: unknown): value is DailySessionItemOption {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.id) && isNonEmptyString(value.label);
}

export function isDailySessionItemOptionArray(
  value: unknown,
): value is DailySessionItemOption[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every(isDailySessionItemOption)) return false;

  const ids = value.map((option: DailySessionItemOption) => option.id);
  return new Set(ids).size === ids.length;
}

export function isDailySessionItemAnswerKey(
  value: unknown,
): value is DailySessionItemAnswerKey {
  if (!isPlainObject(value)) return false;

  if (value.kind === 'single_choice') {
    return (
      Array.isArray(value.acceptedOptionIds) &&
      value.acceptedOptionIds.length > 0 &&
      value.acceptedOptionIds.every((id: unknown) => isNonEmptyString(id))
    );
  }

  if (value.kind === 'text') {
    return (
      Array.isArray(value.acceptedAnswers) &&
      value.acceptedAnswers.length > 0 &&
      value.acceptedAnswers.every((answer: unknown) => isNonEmptyString(answer)) &&
      typeof value.caseSensitive === 'boolean'
    );
  }

  return false;
}

export function isDailySessionAnswerPayload(value: unknown): value is DailySessionAnswerPayload {
  if (!isPlainObject(value)) return false;

  if (value.kind === 'single_choice') {
    return isNonEmptyString(value.optionId);
  }

  if (value.kind === 'text') {
    return typeof value.value === 'string';
  }

  if (value.kind === 'unanswered') {
    return true;
  }

  return false;
}

export function isDailySessionSentenceTarget(
  value: unknown,
): value is DailySessionSentenceTarget {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) && isNonEmptyString(value.targetText) && isNonEmptyString(value.hint)
  );
}

export function isDailySessionSentenceTargetArray(
  value: unknown,
): value is DailySessionSentenceTarget[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every(isDailySessionSentenceTarget)) return false;

  const ids = value.map((target: DailySessionSentenceTarget) => target.id);
  return new Set(ids).size === ids.length;
}

/** Trims, drops blanks, lowercases and dedupes — same normalization Practice/flashcards use for tags. */
export function normalizeSkillTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

// Keys that must never end up in a persisted JSONB metadata blob — secrets,
// full prompts, or raw provider request/response data. Also guards against
// accidentally persisting Knowledge Base chunk content instead of just its
// source name/page (see generation_metadata.knowledgeSourceNames).
const FORBIDDEN_METADATA_KEYS = new Set([
  'apiKey',
  'api_key',
  'authorization',
  'prompt',
  'systemPrompt',
  'headers',
  'messages',
  'knowledgeSourceContent',
]);

/**
 * Guards `generation_metadata` against accidentally smuggling secrets or
 * full prompts. Does not validate a fixed shape — the bag is intentionally
 * open-ended (see DailySessionGenerationMetadata).
 */
export function isSafeGenerationMetadata(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => !FORBIDDEN_METADATA_KEYS.has(key));
}
