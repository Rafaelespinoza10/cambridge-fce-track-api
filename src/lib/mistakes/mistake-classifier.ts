import { MistakeClassificationSource, MistakeErrorSubtype, MistakeErrorType, WordClass } from '@models/enums';
import { normalizeTextAnswer } from '@lib/practice/practice-attempt-grading';
import { levenshteinDistance } from './levenshtein-distance';
import { classifyBaseWordClass, classifyWordClass } from './word-class-heuristics';
import { stripKnownPrefix, stripKnownSuffix } from './affix-catalog';
import { classifyKeyWordTransformation, classifyOpenCloze } from './task-type-classifiers';

/**
 * Deterministic, no-AI classification of a Use of English mistake into
 * errorType/errorSubtype/expectedWordClass/userWordClass.
 *
 * `MistakeClassifier` is a dispatcher: it routes on task type to the
 * classifier that has a real signal for it (see task-type-classifiers.ts for
 * Parts 2 and 4), and owns the Word Formation logic below. Multiple Choice
 * Cloze (Part 1) has no deterministic signal worth trusting — telling a
 * collocation apart from a phrasal verb from a semantic nuance needs actual
 * lexical knowledge — so it is left UNKNOWN here and picked up by the
 * separate AI pass (see classify-mistakes-with-ai.service.ts).
 *
 * The Word Formation rules that follow classify
 *
 * Why no dictionary of words: a suffix-based heuristic generalizes to any
 * root Cambridge (or an LLM generating new exercises) ever throws at it,
 * where a hardcoded word list would need updating forever and still miss
 * words. The tradeoff is real — suffix heuristics get some words wrong or
 * can't resolve them at all — which is exactly why this never forces a
 * classification it isn't confident in: every branch below prefers to leave
 * a field null/UNKNOWN over guessing. False negatives (UNKNOWN) are the
 * intended, safe failure mode; false positives are not, because this data
 * will later feed Practice My Mistakes and the adaptive system.
 *
 * Only ever called for an already-confirmed WRONG answer on a `word_formation`
 * item with a resolvable base word — everything else (other task types, a
 * correct answer, an unparseable prompt) is out of scope for this classifier
 * and returns UNKNOWN untouched.
 */

export interface MistakeClassificationInput {
  baseWord: string | null;
  userAnswer: string;
  correctAnswer: string;
  taskType: string | null;
}

export interface MistakeClassificationResult {
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  expectedWordClass: WordClass | null;
  userWordClass: WordClass | null;
  /** Not persisted today (no column for it) — kept on the result for when a later phase needs it (e.g. deciding whether a low-confidence deterministic hit is still worth an AI second pass). */
  confidence: number;
  classificationSource: MistakeClassificationSource;
}

const UNCLASSIFIED: MistakeClassificationResult = {
  errorType: MistakeErrorType.UNKNOWN,
  errorSubtype: null,
  expectedWordClass: null,
  userWordClass: null,
  confidence: 0,
  classificationSource: MistakeClassificationSource.UNKNOWN,
};

const WORD_CLASS_SUBTYPE_MAP: Partial<Record<string, MistakeErrorSubtype>> = {
  [`${WordClass.NOUN}_${WordClass.ADJECTIVE}`]: MistakeErrorSubtype.NOUN_TO_ADJECTIVE,
  [`${WordClass.NOUN}_${WordClass.ADVERB}`]: MistakeErrorSubtype.NOUN_TO_ADVERB,
  [`${WordClass.ADJECTIVE}_${WordClass.NOUN}`]: MistakeErrorSubtype.ADJECTIVE_TO_NOUN,
  [`${WordClass.ADJECTIVE}_${WordClass.ADVERB}`]: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
  [`${WordClass.VERB}_${WordClass.NOUN}`]: MistakeErrorSubtype.VERB_TO_NOUN,
  [`${WordClass.VERB}_${WordClass.ADJECTIVE}`]: MistakeErrorSubtype.VERB_TO_ADJECTIVE,
};

const WORD_FORMATION_TASK_TYPE = 'word_formation';
const KEY_WORD_TRANSFORMATION_TASK_TYPE = 'key_word_transformation';
const OPEN_CLOZE_TASK_TYPE = 'open_cloze';
const MIN_WORD_LENGTH = 3;
const SPELLING_MAX_LENGTH_DIFF = 2;
/** Relative to the longer word's length, floor 1 — conservative on purpose (see doc comment above). */
const SPELLING_THRESHOLD_RATIO = 0.2;

function isCloseSpelling(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > SPELLING_MAX_LENGTH_DIFF) return false;
  if (a[0] !== b[0]) return false;

  const maxLength = Math.max(a.length, b.length);
  const threshold = Math.max(1, Math.floor(maxLength * SPELLING_THRESHOLD_RATIO));
  const distance = levenshteinDistance(a, b);
  return distance > 0 && distance <= threshold;
}

type AffixSwapKind = 'prefix' | 'suffix';

/**
 * Detects that user/correct differ by ONLY a recognized prefix or suffix —
 * e.g. "unnecessary" vs "necessary" (prefix), "careful" vs "careless"
 * (suffix). Requires an EXACT stem match after stripping, not a close one:
 * this is deliberately stricter than isCloseSpelling so the two never
 * overlap on the same pair, and it never fires on two words that merely
 * happen to be similar-looking.
 */
function detectAffixSwap(a: string, b: string): AffixSwapKind | null {
  const aNoPrefix = stripKnownPrefix(a);
  const bNoPrefix = stripKnownPrefix(b);
  const aPrefixStem = aNoPrefix ?? a;
  const bPrefixStem = bNoPrefix ?? b;
  if ((aNoPrefix !== null || bNoPrefix !== null) && aPrefixStem === bPrefixStem) {
    return 'prefix';
  }

  const aSuffix = stripKnownSuffix(a);
  const bSuffix = stripKnownSuffix(b);
  if (aSuffix !== null && bSuffix !== null && aSuffix.suffix !== bSuffix.suffix && aSuffix.stem === bSuffix.stem) {
    return 'suffix';
  }

  return null;
}

export class MistakeClassifier {
  classify(input: MistakeClassificationInput): MistakeClassificationResult {
    if (input.taskType === KEY_WORD_TRANSFORMATION_TASK_TYPE) {
      return classifyKeyWordTransformation(input);
    }
    if (input.taskType === OPEN_CLOZE_TASK_TYPE) {
      return classifyOpenCloze(input);
    }
    if (input.taskType !== WORD_FORMATION_TASK_TYPE || input.baseWord === null) {
      return UNCLASSIFIED;
    }

    const user = normalizeTextAnswer(input.userAnswer, false);
    const correct = normalizeTextAnswer(input.correctAnswer, false);
    if (user === '' || correct === '' || user.includes(' ') || correct.includes(' ')) {
      return UNCLASSIFIED;
    }
    if (user.length < MIN_WORD_LENGTH || correct.length < MIN_WORD_LENGTH) {
      return UNCLASSIFIED;
    }

    const baseClass = classifyBaseWordClass(normalizeTextAnswer(input.baseWord, false));
    const userClass = classifyWordClass(user, baseClass);
    const expectedClass = classifyWordClass(correct, baseClass);

    if (userClass !== null && expectedClass !== null && userClass !== expectedClass) {
      return {
        errorType: MistakeErrorType.WORD_CLASS,
        errorSubtype: WORD_CLASS_SUBTYPE_MAP[`${userClass}_${expectedClass}`] ?? null,
        expectedWordClass: expectedClass,
        userWordClass: userClass,
        confidence: 0.9,
        classificationSource: MistakeClassificationSource.DETERMINISTIC,
      };
    }

    if (isCloseSpelling(user, correct)) {
      return {
        errorType: MistakeErrorType.SPELLING,
        errorSubtype: MistakeErrorSubtype.SPELLING_CHANGE,
        expectedWordClass: expectedClass,
        userWordClass: userClass,
        confidence: 0.85,
        classificationSource: MistakeClassificationSource.DETERMINISTIC,
      };
    }

    const affixSwap = detectAffixSwap(user, correct);
    if (affixSwap !== null) {
      return {
        errorType: MistakeErrorType.PREFIX_SUFFIX,
        errorSubtype:
          affixSwap === 'prefix' ? MistakeErrorSubtype.PREFIX_ERROR : MistakeErrorSubtype.SUFFIX_ERROR,
        expectedWordClass: expectedClass,
        userWordClass: userClass,
        confidence: 0.75,
        classificationSource: MistakeClassificationSource.DETERMINISTIC,
      };
    }

    // Same word class (or unresolved) with no spelling-level or affix-level
    // relationship detected: this COULD be a genuine vocabulary substitution,
    // but nothing here actually confirms that — no dictionary, no semantic
    // signal. Guessing VOCABULARY here would be exactly the false positive
    // this classifier is built to avoid, so it stays UNKNOWN. The word
    // classes themselves, when resolved, are still real, non-guessed facts
    // worth keeping even though the overall error type isn't.
    return {
      ...UNCLASSIFIED,
      expectedWordClass: expectedClass,
      userWordClass: userClass,
    };
  }
}
