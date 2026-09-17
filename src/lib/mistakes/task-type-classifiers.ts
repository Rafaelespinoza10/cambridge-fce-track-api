import {
  MistakeClassificationSource,
  MistakeErrorSubtype,
  MistakeErrorType,
} from '@models/enums';
import { normalizeTextAnswer } from '@lib/practice/practice-attempt-grading';
import { classifyFunctionWord } from './function-word-catalog';
import { looksCausative, structureForKeyWord } from './key-word-catalog';
import type { MistakeClassificationResult } from './mistake-classifier';

/**
 * Deterministic classifiers for the two Use of English parts outside Word
 * Formation where a real, non-guessed signal exists:
 *
 *  - Key Word Transformation (Part 4): the key word Cambridge hands the
 *    student forces one structure, so the subtype names that STRUCTURE
 *    (passive, conditional…) rather than the nature of the slip. That is
 *    what targeted practice needs in order to generate more of the same,
 *    and it is the only thing knowable without parsing English.
 *  - Open Cloze (Part 2): the answer is always a function word, and those
 *    form a closed set, so the subtype names the CLASS the gap required.
 *
 * Both follow the same rule as the Word Formation classifier: prefer UNKNOWN
 * over a wrong classification. This data feeds Practice My Mistakes and
 * spaced retesting, where a false positive sends the student to drill a
 * weakness they never had.
 */

const UNCLASSIFIED: MistakeClassificationResult = {
  errorType: MistakeErrorType.UNKNOWN,
  errorSubtype: null,
  expectedWordClass: null,
  userWordClass: null,
  confidence: 0,
  classificationSource: MistakeClassificationSource.UNKNOWN,
};

/** Cambridge's own rule for Part 4: the gap takes between 2 and 5 words. */
const MIN_TRANSFORMATION_WORDS = 2;
const MAX_TRANSFORMATION_WORDS = 5;

function words(value: string): string[] {
  return value.split(' ').filter((word) => word !== '');
}

/**
 * Key Word Transformation (UoE Part 4).
 *
 * Order matters, and it is deliberate: the two mechanical checks come first
 * because they are certainties about the answer itself ("you didn't use the
 * key word", "you wrote six words"), and no amount of structural insight
 * helps a student who broke the rules of the task. Only then does the key
 * word decide which structure was under test.
 */
export function classifyKeyWordTransformation(input: {
  baseWord: string | null;
  userAnswer: string;
  correctAnswer: string;
}): MistakeClassificationResult {
  const keyWord = input.baseWord === null ? null : normalizeTextAnswer(input.baseWord, false);
  const user = normalizeTextAnswer(input.userAnswer, false);
  const correct = normalizeTextAnswer(input.correctAnswer, false);
  if (correct === '') return UNCLASSIFIED;

  const userWords = words(user);

  // Mechanical, and certain — but only claimable when the student actually
  // wrote something. An unanswered item is not a rule violation.
  if (userWords.length > 0 && keyWord !== null && keyWord !== '') {
    if (!userWords.includes(keyWord)) {
      return {
        errorType: MistakeErrorType.CARELESS,
        errorSubtype: MistakeErrorSubtype.KEY_WORD_ALTERED,
        expectedWordClass: null,
        userWordClass: null,
        confidence: 0.95,
        classificationSource: MistakeClassificationSource.DETERMINISTIC,
      };
    }
    if (
      userWords.length < MIN_TRANSFORMATION_WORDS ||
      userWords.length > MAX_TRANSFORMATION_WORDS
    ) {
      return {
        errorType: MistakeErrorType.CARELESS,
        errorSubtype: MistakeErrorSubtype.WORD_COUNT,
        expectedWordClass: null,
        userWordClass: null,
        confidence: 0.95,
        classificationSource: MistakeClassificationSource.DETERMINISTIC,
      };
    }
  }

  if (keyWord === null || keyWord === '') return UNCLASSIFIED;

  const correctWords = words(correct);
  // Causative outranks the plain passive reading: "have the car repaired"
  // shares its auxiliaries with the passive but is a different structure.
  const structure = looksCausative(correctWords)
    ? MistakeErrorSubtype.CAUSATIVE
    : structureForKeyWord(keyWord);

  if (structure === null) return UNCLASSIFIED;

  return {
    errorType: MistakeErrorType.GRAMMAR,
    errorSubtype: structure,
    expectedWordClass: null,
    userWordClass: null,
    confidence: 0.8,
    classificationSource: MistakeClassificationSource.DETERMINISTIC,
  };
}

/**
 * Open Cloze (UoE Part 2). Classifies the class of the word the gap
 * required — not what the student wrote, which may be anything at all. The
 * weakness worth practising is "you struggle with prepositions", and that is
 * a property of the answer, not of the slip.
 */
export function classifyOpenCloze(input: {
  userAnswer: string;
  correctAnswer: string;
}): MistakeClassificationResult {
  const correct = normalizeTextAnswer(input.correctAnswer, false);
  // Open Cloze is one word by definition; anything else means the item (or
  // the answer key) isn't shaped the way this classifier assumes.
  if (correct === '' || correct.includes(' ')) return UNCLASSIFIED;

  const subtype = classifyFunctionWord(correct);
  if (subtype === null) return UNCLASSIFIED;

  return {
    errorType: MistakeErrorType.GRAMMAR,
    errorSubtype: subtype,
    expectedWordClass: null,
    userWordClass: null,
    // Higher than the other deterministic paths: this is a closed-set lookup,
    // not a heuristic about morphology.
    confidence: 0.95,
    classificationSource: MistakeClassificationSource.DETERMINISTIC,
  };
}
