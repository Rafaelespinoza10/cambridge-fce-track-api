import { MistakeErrorSubtype } from '@models/enums';

/**
 * Which grammatical structure a Key Word Transformation (UoE Part 4) item is
 * testing, read off its key word.
 *
 * Cambridge Part 4 always hands the student the key word in capitals and
 * forbids changing it, which makes that word an unusually honest signal: the
 * exam itself chose it precisely because it forces one structure. So this is
 * a small hand-picked table of key words, NOT an attempt to parse English —
 * the same tradeoff affix-catalog.ts makes for Word Formation.
 *
 * A key word not in this table resolves to null, and the classifier then
 * falls back to FIXED_EXPRESSION only when it has other evidence. Unknown is
 * always preferred over a wrong structure: this data feeds targeted practice.
 */

interface KeyWordRule {
  /** Matched against the normalized (lowercased) key word, exactly. */
  keyWord: string;
  structure: MistakeErrorSubtype;
}

const KEY_WORD_RULES: readonly KeyWordRule[] = [
  // Passive / causative share auxiliaries, so the distinction is made by the
  // classifier (HAVE/GET + participle => causative), not by the key word alone.
  { keyWord: 'been', structure: MistakeErrorSubtype.PASSIVE },
  { keyWord: 'being', structure: MistakeErrorSubtype.PASSIVE },
  { keyWord: 'by', structure: MistakeErrorSubtype.PASSIVE },

  { keyWord: 'if', structure: MistakeErrorSubtype.CONDITIONAL },
  { keyWord: 'unless', structure: MistakeErrorSubtype.CONDITIONAL },
  { keyWord: 'otherwise', structure: MistakeErrorSubtype.CONDITIONAL },
  { keyWord: 'provided', structure: MistakeErrorSubtype.CONDITIONAL },
  { keyWord: 'were', structure: MistakeErrorSubtype.CONDITIONAL },

  { keyWord: 'said', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'told', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'asked', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'admitted', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'denied', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'suggested', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'apologised', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'apologized', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'accused', structure: MistakeErrorSubtype.REPORTED_SPEECH },
  { keyWord: 'warned', structure: MistakeErrorSubtype.REPORTED_SPEECH },

  { keyWord: 'as', structure: MistakeErrorSubtype.COMPARATIVE },
  { keyWord: 'than', structure: MistakeErrorSubtype.COMPARATIVE },
  { keyWord: 'most', structure: MistakeErrorSubtype.COMPARATIVE },
  { keyWord: 'least', structure: MistakeErrorSubtype.COMPARATIVE },
  { keyWord: 'nearly', structure: MistakeErrorSubtype.COMPARATIVE },
  { keyWord: 'far', structure: MistakeErrorSubtype.COMPARATIVE },

  { keyWord: 'wish', structure: MistakeErrorSubtype.WISH_REGRET },
  { keyWord: 'rather', structure: MistakeErrorSubtype.WISH_REGRET },
  { keyWord: 'time', structure: MistakeErrorSubtype.WISH_REGRET },
  { keyWord: 'only', structure: MistakeErrorSubtype.WISH_REGRET },

  { keyWord: 'used', structure: MistakeErrorSubtype.USED_TO },
  { keyWord: 'use', structure: MistakeErrorSubtype.USED_TO },
  { keyWord: 'accustomed', structure: MistakeErrorSubtype.USED_TO },

  { keyWord: 'must', structure: MistakeErrorSubtype.MODAL_DEDUCTION },
  { keyWord: 'cannot', structure: MistakeErrorSubtype.MODAL_DEDUCTION },
  { keyWord: "can't", structure: MistakeErrorSubtype.MODAL_DEDUCTION },
  { keyWord: 'needn’t', structure: MistakeErrorSubtype.MODAL_DEDUCTION },
  { keyWord: "needn't", structure: MistakeErrorSubtype.MODAL_DEDUCTION },
  { keyWord: 'should', structure: MistakeErrorSubtype.MODAL_DEDUCTION },
  { keyWord: 'ought', structure: MistakeErrorSubtype.MODAL_DEDUCTION },

  { keyWord: 'whose', structure: MistakeErrorSubtype.RELATIVE_CLAUSE },
  { keyWord: 'which', structure: MistakeErrorSubtype.RELATIVE_CLAUSE },
  { keyWord: 'whom', structure: MistakeErrorSubtype.RELATIVE_CLAUSE },

  { keyWord: 'worth', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
  { keyWord: 'mind', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
  { keyWord: 'avoid', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
  { keyWord: 'manage', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
  { keyWord: 'managed', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
  { keyWord: 'bother', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
  { keyWord: 'point', structure: MistakeErrorSubtype.GERUND_INFINITIVE },
];

const RULES_BY_KEY_WORD = new Map(
  KEY_WORD_RULES.map((rule) => [rule.keyWord, rule.structure]),
);

/** Auxiliaries that make a causative reading possible when followed by a past participle. */
const CAUSATIVE_AUXILIARIES = new Set(['have', 'had', 'get', 'got', 'getting', 'having']);

/**
 * Past-participle shape, good enough to separate "have the car repaired"
 * (causative) from "have a look" (not). Irregular participles are covered by
 * a short list rather than a dictionary — the same deliberate limit as the
 * rest of this module.
 */
const IRREGULAR_PARTICIPLES = new Set([
  'been','done','gone','seen','taken','given','written','broken','stolen','spoken',
  'known','shown','driven','eaten','fallen','forgotten','made','sent','built','told',
  'kept','left','lost','paid','put','read','said','sold','cut','set','hit','held',
]);

export function looksLikePastParticiple(word: string): boolean {
  if (IRREGULAR_PARTICIPLES.has(word)) return true;
  return word.length > 3 && word.endsWith('ed');
}

/** The structure this key word forces, or null when it isn't one we recognize. */
export function structureForKeyWord(keyWord: string): MistakeErrorSubtype | null {
  return RULES_BY_KEY_WORD.get(keyWord) ?? null;
}

/**
 * Causative ("have/get SOMETHING done") — the auxiliary, then an object, then
 * a past participle.
 *
 * The object in between is what makes this a causative rather than a perfect:
 * "had the car repaired" has one, "must have forgotten" does not. Without
 * that gap the check would swallow every modal perfect in the language, which
 * is exactly the false positive this module exists to avoid.
 */
export function looksCausative(answerWords: string[]): boolean {
  const auxIndex = answerWords.findIndex((word) => CAUSATIVE_AUXILIARIES.has(word));
  if (auxIndex === -1) return false;
  // At least one intervening word before the participle.
  return answerWords.slice(auxIndex + 2).some(looksLikePastParticiple);
}
