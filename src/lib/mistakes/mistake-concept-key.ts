import { normalizeTextAnswer } from '@lib/practice/practice-attempt-grading';

/**
 * Pure helpers that turn one graded practice item into the *identity* of the
 * thing the student got wrong. No DB, no AI, no classification — the error
 * type/subtype and word classes are deliberately NOT decided here (they stay
 * `unknown`/null until a later classification step exists).
 */

/** Mirrors the seeded `skills.slug` values — see config/seed/data/skills.ts. */
const SKILL_SLUG_BY_PART_PREFIX: Readonly<Record<string, string>> = {
  UOE: 'use-of-english',
  READING: 'reading',
  WRITING: 'writing',
  LISTENING: 'listening',
  SPEAKING: 'speaking',
};

/**
 * Used when a part code doesn't match any known prefix. Not a seeded skill
 * slug on purpose: a row carrying it is visibly "we don't know", never
 * silently filed under Use of English.
 */
export const UNKNOWN_SKILL_SLUG = 'unknown';

/**
 * Derived from the part code (`UOE_PART_3` -> `use-of-english`), the same
 * mechanical mapping progress.repository.ts already does in SQL. Not a new
 * taxonomy — the slugs come from the seeded `skills` table.
 */
export function resolveSkillSlug(partCode: string): string {
  const prefix = partCode.split('_')[0]?.toUpperCase() ?? '';
  return SKILL_SLUG_BY_PART_PREFIX[prefix] ?? UNKNOWN_SKILL_SLUG;
}

/**
 * Task types whose prompt carries a single root/key word in capitals, per
 * this app's own generation prompts (prompts/practice/task-types/
 * word-formation.md and key-word-transformation.md). Only these are parsed —
 * guessing a "base word" out of a reading comprehension question would
 * fabricate data.
 */
const BASE_WORD_TASK_TYPES = new Set(['word_formation', 'key_word_transformation']);

const STANDALONE_CAPS_LINE = /^[A-Z][A-Z'-]+$/;
const CAPS_TOKEN = /\b[A-Z][A-Z'-]+\b/g;
const MAX_BASE_WORD_LENGTH = 120;

/**
 * Extracts the root word the item asked the student to transform, e.g.
 * `RESPONSIBLE` from "Form a word from RESPONSIBLE to fit gap (1)." Returns
 * null whenever it isn't unambiguous — a prompt with two capitalized tokens
 * is left unresolved rather than guessed. Deterministic string parsing of
 * our own prompt format; never an inference about English.
 */
export function extractBaseWord(taskType: string | null, prompt: string): string | null {
  if (taskType === null || !BASE_WORD_TASK_TYPES.has(taskType)) return null;

  // Key Word Transformation puts the key word alone on its own line.
  for (const line of prompt.split('\n')) {
    const trimmed = line.trim();
    if (STANDALONE_CAPS_LINE.test(trimmed)) {
      return trimmed.slice(0, MAX_BASE_WORD_LENGTH);
    }
  }

  const tokens = new Set(prompt.match(CAPS_TOKEN) ?? []);
  if (tokens.size !== 1) return null;
  return [...tokens][0].slice(0, MAX_BASE_WORD_LENGTH);
}

/**
 * Task types where the mistake is about a *word* (the same target word can
 * legitimately show up in different exercises, and failing it twice is the
 * same weakness). Everything else — reading comprehension, matching, gapped
 * text — is keyed by the item itself, because two questions sharing the
 * option label "B" have nothing in common.
 */
const LEXICAL_TASK_TYPES = new Set([
  'word_formation',
  'key_word_transformation',
  'open_cloze',
  'multiple_choice_cloze',
]);

const MAX_KEY_TOKEN_LENGTH = 120;

function keyToken(value: string): string {
  // Reuses the grading normalizer (NFKC + apostrophes + case + whitespace)
  // so a concept key can never disagree with how the answer was graded.
  const normalized = normalizeTextAnswer(value, false).replace(/\|/g, '/');
  return normalized.slice(0, MAX_KEY_TOKEN_LENGTH);
}

export interface BuildConceptKeyInput {
  partCode: string;
  taskType: string | null;
  itemId: string;
  baseWord: string | null;
  /** The first accepted answer — see formatAcceptedAnswers in practice-attempt-grading.ts. */
  primaryCorrectAnswer: string;
}

/**
 * Stable, readable natural key — `uoe_part_3|responsible|responsibly`. Same
 * concept failed again (even in a different exercise) produces the same key,
 * which is what makes `times_wrong`/frequency meaningful instead of a pile
 * of near-duplicate rows.
 */
export function buildConceptKey(input: BuildConceptKeyInput): string {
  const part = keyToken(input.partCode);

  if (input.taskType !== null && LEXICAL_TASK_TYPES.has(input.taskType)) {
    const base = input.baseWord === null ? 'na' : keyToken(input.baseWord);
    return `${part}|${base}|${keyToken(input.primaryCorrectAnswer)}`;
  }

  return `${part}|item|${input.itemId}`;
}
