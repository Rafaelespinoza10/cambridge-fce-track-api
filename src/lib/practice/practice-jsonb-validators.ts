import type {
  PracticeItemOption,
  PracticeItemAnswerKey,
  PracticeAnswerPayload,
} from '@models/practice-json-types';

/**
 * Pure type guards for the JSONB columns on the Practice entities. Postgres
 * cannot validate a JSONB column's internal shape, so repositories must run
 * these before persisting anything — this is the only schema enforcement
 * those columns get.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isPracticeItemOption(value: unknown): value is PracticeItemOption {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.id) && isNonEmptyString(value.label);
}

export function isPracticeItemOptionArray(value: unknown): value is PracticeItemOption[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every(isPracticeItemOption)) return false;

  const ids = value.map((option: PracticeItemOption) => option.id);
  return new Set(ids).size === ids.length;
}

export function isPracticeItemAnswerKey(value: unknown): value is PracticeItemAnswerKey {
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

export function isPracticeAnswerPayload(value: unknown): value is PracticeAnswerPayload {
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

/** Trims, drops blanks, lowercases and dedupes — same normalization the flashcards tag flow uses. */
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
// full prompts, or raw provider request/response data.
const FORBIDDEN_METADATA_KEYS = new Set([
  'apiKey',
  'api_key',
  'authorization',
  'prompt',
  'systemPrompt',
  'headers',
  'messages',
]);

/**
 * Guards `generation_metadata` (and any other free-form JSONB bag) against
 * accidentally smuggling secrets or full prompts. Does not validate a fixed
 * shape — the bag is intentionally open-ended (see PracticeExerciseGenerationMetadata).
 */
export function isSafeGenerationMetadata(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => !FORBIDDEN_METADATA_KEYS.has(key));
}
