import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  buildConceptKey,
  extractBaseWord,
  resolveSkillSlug,
  UNKNOWN_SKILL_SLUG,
} from './mistake-concept-key';

describe('resolveSkillSlug', () => {
  it('maps every practice part prefix to its seeded skill slug', () => {
    assert.equal(resolveSkillSlug('UOE_PART_3'), 'use-of-english');
    assert.equal(resolveSkillSlug('READING_PART_5'), 'reading');
    assert.equal(resolveSkillSlug('WRITING_PART_1'), 'writing');
    assert.equal(resolveSkillSlug('LISTENING_PART_2'), 'listening');
    assert.equal(resolveSkillSlug('SPEAKING_PART_4'), 'speaking');
  });

  it('files an unrecognized part code under `unknown` instead of guessing a skill', () => {
    assert.equal(resolveSkillSlug('SOMETHING_ELSE'), UNKNOWN_SKILL_SLUG);
    assert.equal(resolveSkillSlug(''), UNKNOWN_SKILL_SLUG);
  });
});

describe('extractBaseWord', () => {
  it('extracts the root word from a Word Formation prompt', () => {
    assert.equal(
      extractBaseWord('word_formation', 'Form a word from RESPONSIBLE to fit gap (1).'),
      'RESPONSIBLE',
    );
  });

  it('extracts the key word from a Key Word Transformation prompt line', () => {
    const prompt = 'She last visited Paris three years ago.\nBEEN\nShe ____ Paris for three years.';
    assert.equal(extractBaseWord('key_word_transformation', prompt), 'BEEN');
  });

  it('returns null when two different capitalized tokens make it ambiguous', () => {
    assert.equal(
      extractBaseWord('word_formation', 'Form a word from INFORM or ADVISE to fit gap (1).'),
      null,
    );
  });

  it('returns null for task types whose prompt carries no root word', () => {
    assert.equal(extractBaseWord('open_cloze', 'Write ONE word for gap (1).'), null);
    assert.equal(extractBaseWord('multiple_choice', 'What does the writer suggest?'), null);
    assert.equal(extractBaseWord(null, 'Form a word from INFORM.'), null);
  });
});

describe('buildConceptKey', () => {
  const wordFormation = {
    partCode: 'UOE_PART_3',
    taskType: 'word_formation',
    itemId: 'item-1',
    baseWord: 'RESPONSIBLE',
    primaryCorrectAnswer: 'responsibly',
  };

  it('keys a lexical item by part + base word + correct answer', () => {
    assert.equal(buildConceptKey(wordFormation), 'uoe_part_3|responsible|responsibly');
  });

  it('gives the same key to the same concept failed in a different exercise', () => {
    assert.equal(
      buildConceptKey({ ...wordFormation, itemId: 'another-item' }),
      buildConceptKey(wordFormation),
    );
  });

  it('normalizes case and spacing exactly like the grader does', () => {
    assert.equal(
      buildConceptKey({
        ...wordFormation,
        baseWord: '  Responsible ',
        primaryCorrectAnswer: 'RESPONSIBLY',
      }),
      buildConceptKey(wordFormation),
    );
  });

  it('keeps two different target words apart', () => {
    assert.notEqual(
      buildConceptKey({ ...wordFormation, baseWord: 'AVAILABLE', primaryCorrectAnswer: 'availability' }),
      buildConceptKey(wordFormation),
    );
  });

  it('keys a non-lexical item by the item itself, so two questions never merge', () => {
    const reading = {
      partCode: 'READING_PART_5',
      taskType: 'multiple_choice',
      itemId: 'item-1',
      baseWord: null,
      primaryCorrectAnswer: 'B',
    };
    assert.equal(buildConceptKey(reading), 'reading_part_5|item|item-1');
    assert.notEqual(buildConceptKey({ ...reading, itemId: 'item-2' }), buildConceptKey(reading));
  });

  it('marks a lexical item with no extractable base word instead of dropping the slot', () => {
    assert.equal(
      buildConceptKey({
        partCode: 'UOE_PART_2',
        taskType: 'open_cloze',
        itemId: 'item-9',
        baseWord: null,
        primaryCorrectAnswer: 'been',
      }),
      'uoe_part_2|na|been',
    );
  });
});
