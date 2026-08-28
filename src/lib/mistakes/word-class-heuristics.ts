import { WordClass } from '@models/enums';
import { AMBIGUOUS_AL_SUFFIX, findReliableBaseSuffixRule, findSuffixRule } from './affix-catalog';

/**
 * Suffix-only classification for a candidate answer (userAnswer or
 * correctAnswer) — never guesses when there's no suffix evidence, EXCEPT for
 * the one genuinely ambiguous suffix in English derivation ("-al": survival
 * vs. natural), which is resolved using the base word's own class instead of
 * guessed from the suffix alone. Returns null rather than force a class onto
 * a word with no recognizable pattern — "no fuerces una clasificación
 * cuando la confianza sea baja" applies here just as much as to errorType.
 */
export function classifyWordClass(word: string, baseWordClass: WordClass | null): WordClass | null {
  const normalized = word.toLowerCase();
  if (normalized.length < 3) return null;

  const rule = findSuffixRule(normalized);
  if (rule !== null) return rule.wordClass;

  if (normalized.length > AMBIGUOUS_AL_SUFFIX.length + 2 && normalized.endsWith(AMBIGUOUS_AL_SUFFIX)) {
    if (baseWordClass === WordClass.VERB) return WordClass.NOUN;
    if (baseWordClass === WordClass.NOUN) return WordClass.ADJECTIVE;
    return null;
  }

  return null;
}

/**
 * Classifies the ROOT word a Word Formation item gives the student (e.g.
 * "SURVIVE"), used only to disambiguate the "-al" suffix above. Unlike
 * classifyWordClass, this one DOES default to VERB when nothing else
 * matches — Cambridge Word Formation roots are overwhelmingly given as bare
 * verb stems (SURVIVE, ARRIVE, DENY, ENCOURAGE, ...), so "no suffix evidence
 * either way" is itself weak evidence for VERB in this specific, narrow
 * context. This assumption is deliberately NOT applied to classifyWordClass
 * above, which classifies actual candidate answers, not exercise roots.
 */
export function classifyBaseWordClass(baseWord: string): WordClass {
  const normalized = baseWord.toLowerCase();
  const rule = findReliableBaseSuffixRule(normalized);
  if (rule !== null) return rule.wordClass;
  return WordClass.VERB;
}
