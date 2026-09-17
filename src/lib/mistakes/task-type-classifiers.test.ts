import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { classifyKeyWordTransformation, classifyOpenCloze } from './task-type-classifiers';
import { MistakeClassifier } from './mistake-classifier';
import {
  MistakeClassificationSource,
  MistakeErrorSubtype,
  MistakeErrorType,
} from '@models/enums';

describe('classifyKeyWordTransformation — mechanical rules come first', () => {
  it('flags an answer that never used the key word', () => {
    const result = classifyKeyWordTransformation({
      baseWord: 'BEEN',
      userAnswer: 'has not visited',
      correctAnswer: 'has not been to',
    });

    assert.equal(result.errorType, MistakeErrorType.CARELESS);
    assert.equal(result.errorSubtype, MistakeErrorSubtype.KEY_WORD_ALTERED);
    assert.equal(result.classificationSource, MistakeClassificationSource.DETERMINISTIC);
  });

  it('flags an answer that changed the key word instead of using it as given', () => {
    const result = classifyKeyWordTransformation({
      baseWord: 'BEEN',
      userAnswer: 'has being to',
      correctAnswer: 'has not been to',
    });

    assert.equal(result.errorSubtype, MistakeErrorSubtype.KEY_WORD_ALTERED);
  });

  it("flags an answer outside Cambridge's 2-5 word limit", () => {
    const tooLong = classifyKeyWordTransformation({
      baseWord: 'BEEN',
      userAnswer: 'has not been to that place before',
      correctAnswer: 'has not been to',
    });
    const tooShort = classifyKeyWordTransformation({
      baseWord: 'BEEN',
      userAnswer: 'been',
      correctAnswer: 'has not been to',
    });

    assert.equal(tooLong.errorSubtype, MistakeErrorSubtype.WORD_COUNT);
    assert.equal(tooShort.errorSubtype, MistakeErrorSubtype.WORD_COUNT);
  });

  it('never calls an unanswered item a rule violation', () => {
    const result = classifyKeyWordTransformation({
      baseWord: 'BEEN',
      userAnswer: '',
      correctAnswer: 'has not been to',
    });

    assert.notEqual(result.errorSubtype, MistakeErrorSubtype.KEY_WORD_ALTERED);
    assert.notEqual(result.errorSubtype, MistakeErrorSubtype.WORD_COUNT);
  });
});

describe('classifyKeyWordTransformation — the structure under test', () => {
  const cases: Array<[string, string, MistakeErrorSubtype]> = [
    ['BEEN', 'has not been to', MistakeErrorSubtype.PASSIVE],
    ['UNLESS', 'unless you hurry up', MistakeErrorSubtype.CONDITIONAL],
    ['ASKED', 'asked me whether i', MistakeErrorSubtype.REPORTED_SPEECH],
    ['THAN', 'is taller than his', MistakeErrorSubtype.COMPARATIVE],
    ['WISH', 'i wish i had', MistakeErrorSubtype.WISH_REGRET],
    ['USED', 'used to live in', MistakeErrorSubtype.USED_TO],
    ['MUST', 'must have forgotten the', MistakeErrorSubtype.MODAL_DEDUCTION],
    ['WHOSE', 'whose car was stolen', MistakeErrorSubtype.RELATIVE_CLAUSE],
    ['WORTH', 'is not worth visiting', MistakeErrorSubtype.GERUND_INFINITIVE],
  ];

  for (const [keyWord, correctAnswer, expected] of cases) {
    it(`reads ${keyWord} as ${expected}`, () => {
      const result = classifyKeyWordTransformation({
        baseWord: keyWord,
        // A wrong answer that still respects the mechanical rules, so the
        // structural branch is the one under test.
        userAnswer: correctAnswer.replace(/\s\S+$/, ' something'),
        correctAnswer,
      });

      assert.equal(result.errorType, MistakeErrorType.GRAMMAR);
      assert.equal(result.errorSubtype, expected);
    });
  }

  it('prefers causative over passive when the answer has have/get + participle', () => {
    const result = classifyKeyWordTransformation({
      baseWord: 'HAD',
      userAnswer: 'had repaired the car',
      correctAnswer: 'had the car repaired',
    });

    assert.equal(result.errorSubtype, MistakeErrorSubtype.CAUSATIVE);
  });

  it('stays unknown for a key word it does not recognize', () => {
    const result = classifyKeyWordTransformation({
      baseWord: 'ZEBRA',
      userAnswer: 'some zebra answer',
      correctAnswer: 'another zebra thing',
    });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
    assert.equal(result.errorSubtype, null);
  });

  it('stays unknown when the item carries no key word at all', () => {
    const result = classifyKeyWordTransformation({
      baseWord: null,
      userAnswer: 'has not visited',
      correctAnswer: 'has not been to',
    });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });
});

describe('classifyOpenCloze', () => {
  const cases: Array<[string, MistakeErrorSubtype]> = [
    ['in', MistakeErrorSubtype.PREPOSITION],
    ['of', MistakeErrorSubtype.PREPOSITION],
    ['the', MistakeErrorSubtype.ARTICLE],
    ['an', MistakeErrorSubtype.ARTICLE],
    ['had', MistakeErrorSubtype.AUXILIARY],
    ['would', MistakeErrorSubtype.AUXILIARY],
    ['which', MistakeErrorSubtype.PRONOUN],
    ['there', MistakeErrorSubtype.PRONOUN],
    ['although', MistakeErrorSubtype.LINKER],
    ['despite', MistakeErrorSubtype.PREPOSITION],
    ['many', MistakeErrorSubtype.QUANTIFIER],
    ['neither', MistakeErrorSubtype.QUANTIFIER],
  ];

  for (const [correctAnswer, expected] of cases) {
    it(`classifies "${correctAnswer}" as ${expected}`, () => {
      const result = classifyOpenCloze({ userAnswer: 'wrong', correctAnswer });

      assert.equal(result.errorType, MistakeErrorType.GRAMMAR);
      assert.equal(result.errorSubtype, expected);
      assert.equal(result.classificationSource, MistakeClassificationSource.DETERMINISTIC);
    });
  }

  it('classifies the answer the gap needed, not what the student wrote', () => {
    const result = classifyOpenCloze({ userAnswer: 'although', correctAnswer: 'in' });

    assert.equal(result.errorSubtype, MistakeErrorSubtype.PREPOSITION);
  });

  it('is case- and space-insensitive about the answer key', () => {
    const result = classifyOpenCloze({ userAnswer: 'x', correctAnswer: '  THE ' });

    assert.equal(result.errorSubtype, MistakeErrorSubtype.ARTICLE);
  });

  it('stays unknown for a lexical answer rather than inventing a class', () => {
    for (const correctAnswer of ['take', 'way', 'course']) {
      const result = classifyOpenCloze({ userAnswer: 'x', correctAnswer });
      assert.equal(result.errorType, MistakeErrorType.UNKNOWN, correctAnswer);
      assert.equal(result.errorSubtype, null);
    }
  });

  it('stays unknown for a multi-word answer key, which Open Cloze never has', () => {
    const result = classifyOpenCloze({ userAnswer: 'x', correctAnswer: 'in spite' });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });
});

describe('MistakeClassifier — dispatch by task type', () => {
  const classifier = new MistakeClassifier();

  it('routes key_word_transformation to its own classifier', () => {
    const result = classifier.classify({
      taskType: 'key_word_transformation',
      baseWord: 'UNLESS',
      userAnswer: 'if you do not',
      correctAnswer: 'unless you hurry up',
    });

    assert.equal(result.errorSubtype, MistakeErrorSubtype.KEY_WORD_ALTERED);
  });

  it('routes open_cloze to its own classifier', () => {
    const result = classifier.classify({
      taskType: 'open_cloze',
      baseWord: null,
      userAnswer: 'on',
      correctAnswer: 'in',
    });

    assert.equal(result.errorSubtype, MistakeErrorSubtype.PREPOSITION);
  });

  it('still classifies word_formation exactly as before', () => {
    const result = classifier.classify({
      taskType: 'word_formation',
      baseWord: 'RESPONSIBLE',
      userAnswer: 'responsible',
      correctAnswer: 'responsibly',
    });

    assert.equal(result.errorType, MistakeErrorType.WORD_CLASS);
    assert.equal(result.errorSubtype, MistakeErrorSubtype.ADJECTIVE_TO_ADVERB);
  });

  it('leaves multiple_choice_cloze unknown — that one is the AI pass', () => {
    const result = classifier.classify({
      taskType: 'multiple_choice_cloze',
      baseWord: null,
      userAnswer: 'made',
      correctAnswer: 'did',
    });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
    assert.equal(result.classificationSource, MistakeClassificationSource.UNKNOWN);
  });

  it('leaves an unrelated task type untouched', () => {
    const result = classifier.classify({
      taskType: 'multiple_choice',
      baseWord: null,
      userAnswer: 'a',
      correctAnswer: 'b',
    });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });
});
