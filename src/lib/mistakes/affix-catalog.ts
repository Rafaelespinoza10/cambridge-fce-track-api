import { WordClass } from '@models/enums';

/**
 * Small, hand-picked suffix tables for English derivational morphology —
 * deliberately NOT a dictionary of words (see mistake-classifier.ts's doc
 * comment on why). Ordered longest-suffix-first within the combined lookup
 * so e.g. "-ment" wins over the shorter "-ent" for "encouragement".
 *
 * `-ing`/`-ed` default to ADJECTIVE: in Cambridge Word Formation items these
 * are overwhelmingly participial adjectives ("encouraging", "interested"),
 * not gerunds or literal verb forms — a deliberate, documented pedagogical
 * simplification, not a general claim about English grammar.
 */
interface SuffixRule {
  suffix: string;
  wordClass: WordClass;
}

const SUFFIX_RULES: readonly SuffixRule[] = [
  // Noun
  { suffix: 'ication', wordClass: WordClass.NOUN },
  { suffix: 'ation', wordClass: WordClass.NOUN },
  { suffix: 'ition', wordClass: WordClass.NOUN },
  { suffix: 'sion', wordClass: WordClass.NOUN },
  { suffix: 'tion', wordClass: WordClass.NOUN },
  { suffix: 'ment', wordClass: WordClass.NOUN },
  { suffix: 'ness', wordClass: WordClass.NOUN },
  { suffix: 'ship', wordClass: WordClass.NOUN },
  { suffix: 'hood', wordClass: WordClass.NOUN },
  { suffix: 'ture', wordClass: WordClass.NOUN },
  { suffix: 'ity', wordClass: WordClass.NOUN },
  { suffix: 'ance', wordClass: WordClass.NOUN },
  { suffix: 'ence', wordClass: WordClass.NOUN },
  { suffix: 'dom', wordClass: WordClass.NOUN },
  { suffix: 'ery', wordClass: WordClass.NOUN },
  { suffix: 'ism', wordClass: WordClass.NOUN },
  { suffix: 'ist', wordClass: WordClass.NOUN },
  { suffix: 'ion', wordClass: WordClass.NOUN },
  // Adjective
  { suffix: 'ible', wordClass: WordClass.ADJECTIVE },
  { suffix: 'able', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ive', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ous', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ful', wordClass: WordClass.ADJECTIVE },
  { suffix: 'less', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ary', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ent', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ant', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ic', wordClass: WordClass.ADJECTIVE },
  // Adverb
  { suffix: 'ly', wordClass: WordClass.ADVERB },
  // Verb
  { suffix: 'ize', wordClass: WordClass.VERB },
  { suffix: 'ise', wordClass: WordClass.VERB },
  { suffix: 'ify', wordClass: WordClass.VERB },
  { suffix: 'ate', wordClass: WordClass.VERB },
  // Participle-as-adjective (see doc comment above)
  { suffix: 'ing', wordClass: WordClass.ADJECTIVE },
  { suffix: 'ed', wordClass: WordClass.ADJECTIVE },
].sort((a, b) => b.suffix.length - a.suffix.length);

/** The one suffix genuinely ambiguous between NOUN and ADJECTIVE in English derivation (survival vs. natural) — handled separately via the base word's class, never guessed from the suffix alone. */
export const AMBIGUOUS_AL_SUFFIX = 'al';

/**
 * A deliberately SMALLER subset of SUFFIX_RULES, safe to apply to a Word
 * Formation ROOT word specifically (classifyBaseWordClass) — the full table
 * includes suffixes that collide with common bare verb roots when applied to
 * a root instead of a derived answer: "survive"/"arrive"/"drive" end in the
 * ADJECTIVE suffix "-ive", "-ing"/"-ed" are never a root's own ending,
 * "-al"/"-ic"/"-ary"/"-ent"/"-ant" have their own ambiguity. Excluding those
 * keeps classifyBaseWordClass's default-to-VERB fallback from being
 * overridden by a false-positive suffix match. "-ture" stays in (NATURE,
 * CULTURE, STRUCTURE are far more common Word Formation roots than the rare
 * base verbs "capture"/"nurture" this could occasionally mis-tag) — an
 * accepted, documented tradeoff, not an oversight.
 */
const RELIABLE_BASE_SUFFIXES: readonly SuffixRule[] = SUFFIX_RULES.filter((rule) =>
  [
    'ible',
    'able',
    'ous',
    'ful',
    'less',
    'ation',
    'ition',
    'sion',
    'tion',
    'ment',
    'ness',
    'ture',
    'ity',
    'ance',
    'ence',
    'ly',
    'ize',
    'ise',
    'ify',
    'ate',
  ].includes(rule.suffix),
);

/** Longest matching suffix from RELIABLE_BASE_SUFFIXES — see its doc comment for why this is a smaller table than findSuffixRule's. */
export function findReliableBaseSuffixRule(word: string): SuffixRule | null {
  for (const rule of RELIABLE_BASE_SUFFIXES) {
    if (word.length > rule.suffix.length && word.endsWith(rule.suffix)) return rule;
  }
  return null;
}

export const NEGATIVE_PREFIXES: readonly string[] = ['un', 'in', 'im', 'il', 'ir', 'dis', 'non', 'mis'].sort(
  (a, b) => b.length - a.length,
);

/** Longest matching suffix from SUFFIX_RULES, or null if none match. Excludes the ambiguous "-al" case on purpose. */
export function findSuffixRule(word: string): SuffixRule | null {
  for (const rule of SUFFIX_RULES) {
    if (word.length > rule.suffix.length && word.endsWith(rule.suffix)) return rule;
  }
  return null;
}

/** Strips a known negative prefix, returning the remainder — or null if the word doesn't start with one. */
export function stripKnownPrefix(word: string): string | null {
  for (const prefix of NEGATIVE_PREFIXES) {
    if (word.length > prefix.length + 2 && word.startsWith(prefix)) {
      return word.slice(prefix.length);
    }
  }
  return null;
}

export interface StrippedSuffix {
  suffix: string;
  stem: string;
}

/** Strips the longest known suffix (including the ambiguous "-al"), returning its stem — or null if none match. */
export function stripKnownSuffix(word: string): StrippedSuffix | null {
  const rule = findSuffixRule(word);
  if (rule !== null) return { suffix: rule.suffix, stem: word.slice(0, -rule.suffix.length) };
  if (word.length > AMBIGUOUS_AL_SUFFIX.length + 2 && word.endsWith(AMBIGUOUS_AL_SUFFIX)) {
    return { suffix: AMBIGUOUS_AL_SUFFIX, stem: word.slice(0, -AMBIGUOUS_AL_SUFFIX.length) };
  }
  return null;
}

export type { SuffixRule };
