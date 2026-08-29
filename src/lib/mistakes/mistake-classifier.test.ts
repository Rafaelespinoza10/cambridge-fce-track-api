import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { MistakeClassificationSource, MistakeErrorSubtype, MistakeErrorType, WordClass } from '@models/enums';
import { MistakeClassifier } from './mistake-classifier';

const classifier = new MistakeClassifier();

function classify(baseWord: string, userAnswer: string, correctAnswer: string) {
  return classifier.classify({
    baseWord,
    userAnswer,
    correctAnswer,
    taskType: 'word_formation',
  });
}

describe('MistakeClassifier — word class (the 4 required real examples)', () => {
  it('RESPONSIBLE: irresponsible -> responsibly is ADJECTIVE_TO_ADVERB', () => {
    const result = classify('RESPONSIBLE', 'IRRESPONSIBLE', 'RESPONSIBLY');
    assert.deepEqual(result, {
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
      expectedWordClass: WordClass.ADVERB,
      userWordClass: WordClass.ADJECTIVE,
      confidence: 0.9,
      classificationSource: MistakeClassificationSource.DETERMINISTIC,
    });
  });

  it('ENCOURAGE: encouragement -> encouraging is NOUN_TO_ADJECTIVE', () => {
    const result = classify('ENCOURAGE', 'ENCOURAGEMENT', 'ENCOURAGING');
    assert.deepEqual(result, {
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE,
      expectedWordClass: WordClass.ADJECTIVE,
      userWordClass: WordClass.NOUN,
      confidence: 0.9,
      classificationSource: MistakeClassificationSource.DETERMINISTIC,
    });
  });

  it('AVAILABLE: availibility -> availability is SPELLING, not WORD_CLASS (same class both sides)', () => {
    const result = classify('AVAILABLE', 'AVAILIBILITY', 'AVAILABILITY');
    assert.deepEqual(result, {
      errorType: MistakeErrorType.SPELLING,
      errorSubtype: MistakeErrorSubtype.SPELLING_CHANGE,
      expectedWordClass: WordClass.NOUN,
      userWordClass: WordClass.NOUN,
      confidence: 0.85,
      classificationSource: MistakeClassificationSource.DETERMINISTIC,
    });
  });

  it('SURVIVE: surviving -> survival is ADJECTIVE_TO_NOUN (the ambiguous "-al" resolved via the verb base)', () => {
    const result = classify('SURVIVE', 'SURVIVING', 'SURVIVAL');
    assert.deepEqual(result, {
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_NOUN,
      expectedWordClass: WordClass.NOUN,
      userWordClass: WordClass.ADJECTIVE,
      confidence: 0.9,
      classificationSource: MistakeClassificationSource.DETERMINISTIC,
    });
  });
});

describe('MistakeClassifier — spelling', () => {
  it('classifies responsably -> responsibly as SPELLING', () => {
    const result = classify('RESPONSIBLE', 'RESPONSABLY', 'RESPONSIBLY');
    assert.equal(result.errorType, MistakeErrorType.SPELLING);
    assert.equal(result.errorSubtype, MistakeErrorSubtype.SPELLING_CHANGE);
  });

  it('classifies enviroment -> environment as SPELLING', () => {
    const result = classify('SURROUND', 'ENVIROMENT', 'ENVIRONMENT');
    assert.equal(result.errorType, MistakeErrorType.SPELLING);
  });
});

describe('MistakeClassifier — prefix/suffix', () => {
  it('detects a wrong negative prefix as PREFIX_SUFFIX/prefix_error', () => {
    const result = classify('NECESSARY', 'UNNECESSARY', 'NECESSARY');
    assert.equal(result.errorType, MistakeErrorType.PREFIX_SUFFIX);
    assert.equal(result.errorSubtype, MistakeErrorSubtype.PREFIX_ERROR);
  });

  it('detects a wrong suffix choice as PREFIX_SUFFIX/suffix_error', () => {
    const result = classify('CARE', 'CAREFUL', 'CARELESS');
    assert.equal(result.errorType, MistakeErrorType.PREFIX_SUFFIX);
    assert.equal(result.errorSubtype, MistakeErrorSubtype.SUFFIX_ERROR);
  });
});

describe('MistakeClassifier — unknown / conservative fallback', () => {
  it('never assigns VOCABULARY deterministically — same class, no affix/spelling relation stays UNKNOWN', () => {
    // Both adjectives via the "-ic" suffix, same class, but not spelling-close
    // and no shared stem: exactly the "same word class, unrelated words" case
    // that must NOT become a guessed VOCABULARY.
    const result = classify('DESCRIBE', 'FANTASTIC', 'CLASSIC');
    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
    assert.equal(result.errorSubtype, null);
    assert.equal(result.expectedWordClass, WordClass.ADJECTIVE);
    assert.equal(result.userWordClass, WordClass.ADJECTIVE);
  });

  it('falls back to UNKNOWN for two unrelated strings with no suffix evidence', () => {
    const result = classify('SOMETHING', 'XYZQW', 'ABCDEF');
    assert.deepEqual(result, {
      errorType: MistakeErrorType.UNKNOWN,
      errorSubtype: null,
      expectedWordClass: null,
      userWordClass: null,
      confidence: 0,
      classificationSource: MistakeClassificationSource.UNKNOWN,
    });
  });

  it('still reports resolved word classes even when the overall errorType is UNKNOWN', () => {
    // Same class (-ity NOUN) on both sides, no spelling/affix relation.
    const result = classify('QUALIFY', 'QUANTITY', 'QUALITY');
    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
    assert.equal(result.expectedWordClass, WordClass.NOUN);
    assert.equal(result.userWordClass, WordClass.NOUN);
  });
});

describe('MistakeClassifier — scope guards', () => {
  // Key Word Transformation and Open Cloze now have their own classifiers
  // (see task-type-classifiers.test.ts); this guard is about the ones that
  // still have no deterministic signal at all.
  it('never classifies a task type with no deterministic signal', () => {
    for (const taskType of ['multiple_choice_cloze', 'multiple_choice', 'gapped_text']) {
      const result = classifier.classify({
        baseWord: 'RESPONSIBLE',
        userAnswer: 'IRRESPONSIBLE',
        correctAnswer: 'RESPONSIBLY',
        taskType,
      });
      assert.equal(result.errorType, MistakeErrorType.UNKNOWN, taskType);
      assert.equal(result.classificationSource, MistakeClassificationSource.UNKNOWN, taskType);
    }
  });

  it('never classifies when there is no base word', () => {
    const result = classifier.classify({
      baseWord: null,
      userAnswer: 'IRRESPONSIBLE',
      correctAnswer: 'RESPONSIBLY',
      taskType: 'word_formation',
    });
    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });

  it('never classifies a multi-word answer', () => {
    const result = classify('RESPONSIBLE', 'not responsible', 'RESPONSIBLY');
    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });
});
