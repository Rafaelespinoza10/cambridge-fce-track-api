import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { WordClass } from '@models/enums';
import { classifyBaseWordClass, classifyWordClass } from './word-class-heuristics';

describe('classifyWordClass', () => {
  it('classifies common suffixes correctly', () => {
    assert.equal(classifyWordClass('responsibly', null), WordClass.ADVERB);
    assert.equal(classifyWordClass('irresponsible', null), WordClass.ADJECTIVE);
    assert.equal(classifyWordClass('available', null), WordClass.ADJECTIVE);
    assert.equal(classifyWordClass('availability', null), WordClass.NOUN);
    assert.equal(classifyWordClass('encouragement', null), WordClass.NOUN);
    assert.equal(classifyWordClass('modernize', null), WordClass.VERB);
  });

  it('prefers the longest matching suffix (encouragement is NOUN, not ADJECTIVE via a stray "-ent")', () => {
    assert.equal(classifyWordClass('encouragement', null), WordClass.NOUN);
  });

  it('treats -ing/-ed as ADJECTIVE (participle-as-adjective convention)', () => {
    assert.equal(classifyWordClass('encouraging', null), WordClass.ADJECTIVE);
    assert.equal(classifyWordClass('surviving', null), WordClass.ADJECTIVE);
    assert.equal(classifyWordClass('interested', null), WordClass.ADJECTIVE);
  });

  it('resolves the ambiguous "-al" suffix using the base word class', () => {
    assert.equal(classifyWordClass('survival', WordClass.VERB), WordClass.NOUN);
    assert.equal(classifyWordClass('natural', WordClass.NOUN), WordClass.ADJECTIVE);
  });

  it('does not guess "-al" when the base word class is unknown', () => {
    assert.equal(classifyWordClass('survival', null), null);
  });

  it('returns null for a word with no recognizable suffix', () => {
    assert.equal(classifyWordClass('cat', null), null);
    assert.equal(classifyWordClass('run', null), null);
  });

  it('returns null for very short strings rather than guess', () => {
    assert.equal(classifyWordClass('ab', null), null);
  });
});

describe('classifyBaseWordClass', () => {
  it('classifies a base word with a recognizable suffix', () => {
    assert.equal(classifyBaseWordClass('responsible'), WordClass.ADJECTIVE);
    assert.equal(classifyBaseWordClass('nature'), WordClass.NOUN);
  });

  it('defaults to VERB for a bare root with no suffix (Cambridge Word Formation convention)', () => {
    assert.equal(classifyBaseWordClass('survive'), WordClass.VERB);
    assert.equal(classifyBaseWordClass('arrive'), WordClass.VERB);
    assert.equal(classifyBaseWordClass('encourage'), WordClass.VERB);
    assert.equal(classifyBaseWordClass('deny'), WordClass.VERB);
  });
});
