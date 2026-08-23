const VERB_TAG_PREFIX = 'verb:';
const VERB_TAG_PATTERN = /^verb:.+$/;

function slugifyVerb(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts the base verb from a phrasal-verb `front` string.
 * Examples: "give up" → "give", "look forward to" → "look", "to get on with" → "get".
 */
function extractPhrasalVerbBase(front: string): string | null {
  const cleaned = front
    .trim()
    .toLowerCase()
    .replace(/[\/|,;].*$/, '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned === '') return null;

  const tokens = cleaned.split(' ').filter(Boolean);
  let index = 0;
  if (tokens[0] === 'to') index = 1;

  const candidate = tokens[index];
  if (candidate === undefined) return null;

  const slug = slugifyVerb(candidate);
  return slug === '' ? null : slug;
}

function buildVerbTag(baseVerb: string): string {
  return `${VERB_TAG_PREFIX}${baseVerb}`;
}

function findVerbTag(tags: string[]): string | undefined {
  return tags.find((tag) => VERB_TAG_PATTERN.test(tag));
}

function stripVerbTags(tags: string[]): string[] {
  return tags.filter((tag) => !VERB_TAG_PATTERN.test(tag));
}

/**
 * Ensures exactly one `verb:{base}` tag derived from `front`.
 * Returns null when the front cannot be parsed into a base verb.
 */
function ensureVerbTag(tags: string[], front: string): string[] | null {
  const baseVerb = extractPhrasalVerbBase(front);
  if (baseVerb === null) return null;

  const withoutVerb = stripVerbTags(tags);
  const verbTag = buildVerbTag(baseVerb);
  if (withoutVerb.includes(verbTag)) return withoutVerb;
  return [...withoutVerb, verbTag];
}

function resolveVerbGroupKey(
  tags: string[],
  front: string,
): { verbTag: string; baseVerb: string } | null {
  const existing = findVerbTag(tags);
  if (existing !== undefined) {
    return { verbTag: existing, baseVerb: existing.slice(VERB_TAG_PREFIX.length) };
  }
  const baseVerb = extractPhrasalVerbBase(front);
  if (baseVerb === null) return null;
  return { verbTag: buildVerbTag(baseVerb), baseVerb };
}

export {
  VERB_TAG_PREFIX,
  VERB_TAG_PATTERN,
  extractPhrasalVerbBase,
  buildVerbTag,
  findVerbTag,
  stripVerbTags,
  ensureVerbTag,
  resolveVerbGroupKey,
};
