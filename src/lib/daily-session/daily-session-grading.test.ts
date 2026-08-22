import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { normalizeTextAnswer, gradeItem, roundToTwoDecimals } from './daily-session-grading';

describe('normalizeTextAnswer', () => {
  it('trims and collapses internal whitespace', () => {
    assert.equal(normalizeTextAnswer('  has   been   ', true), 'has been');
  });

  it('lowercases when caseSensitive is false', () => {
    assert.equal(normalizeTextAnswer('BEEN', false), 'been');
  });

  it('preserves case when caseSensitive is true', () => {
    assert.equal(normalizeTextAnswer('BEEN', true), 'BEEN');
  });

  it('normalizes apostrophe variants to a single canonical apostrophe', () => {
    assert.equal(normalizeTextAnswer('hasn’t', false), "hasn't");
    assert.equal(normalizeTextAnswer('hasn´t', false), "hasn't");
  });

  it('does not fix spelling or accept semantically similar answers', () => {
    assert.notEqual(normalizeTextAnswer('recieve', false), normalizeTextAnswer('receive', false));
  });
});

describe('gradeItem — single_choice', () => {
  const key = { kind: 'single_choice' as const, acceptedOptionIds: ['a'] };

  it('is correct when optionId is accepted', () => {
    const result = gradeItem(key, { kind: 'single_choice', optionId: 'a' });
    assert.deepEqual(result, { isCorrect: true, normalizedAnswer: 'a' });
  });

  it('is incorrect when optionId is not accepted', () => {
    const result = gradeItem(key, { kind: 'single_choice', optionId: 'b' });
    assert.equal(result.isCorrect, false);
  });

  it('is incorrect (not a crash) when the payload kind does not match the key kind', () => {
    const result = gradeItem(key, { kind: 'text', value: 'a' });
    assert.equal(result.isCorrect, false);
  });
});

describe('gradeItem — text', () => {
  const key = { kind: 'text' as const, acceptedAnswers: ["hasn't"], caseSensitive: false };

  it('is correct after normalization matches an accepted answer', () => {
    const result = gradeItem(key, { kind: 'text', value: ' HASN’T  ' });
    assert.equal(result.isCorrect, true);
    assert.equal(result.normalizedAnswer, "hasn't");
  });

  it('is incorrect for a genuinely different answer (no fuzzy matching)', () => {
    const result = gradeItem(key, { kind: 'text', value: 'has not' });
    assert.equal(result.isCorrect, false);
  });

  it('respects caseSensitive: true', () => {
    const csKey = { kind: 'text' as const, acceptedAnswers: ['Paris'], caseSensitive: true };
    assert.equal(gradeItem(csKey, { kind: 'text', value: 'paris' }).isCorrect, false);
    assert.equal(gradeItem(csKey, { kind: 'text', value: 'Paris' }).isCorrect, true);
  });
});

describe('gradeItem — unanswered', () => {
  it('is always incorrect, regardless of the answer key kind', () => {
    const singleChoiceKey = { kind: 'single_choice' as const, acceptedOptionIds: ['a'] };
    const textKey = { kind: 'text' as const, acceptedAnswers: ['x'], caseSensitive: false };
    assert.deepEqual(gradeItem(singleChoiceKey, { kind: 'unanswered' }), {
      isCorrect: false,
      normalizedAnswer: null,
    });
    assert.deepEqual(gradeItem(textKey, { kind: 'unanswered' }), {
      isCorrect: false,
      normalizedAnswer: null,
    });
  });
});

describe('roundToTwoDecimals', () => {
  it('rounds to 2 decimal places', () => {
    assert.equal(roundToTwoDecimals(33.333333), 33.33);
    assert.equal(roundToTwoDecimals(66.666666), 66.67);
    assert.equal(roundToTwoDecimals(100), 100);
  });
});
