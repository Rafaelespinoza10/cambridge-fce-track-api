import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  extractPhrasalVerbBase,
  ensureVerbTag,
  resolveVerbGroupKey,
  buildVerbTag,
} from './phrasal-verb-base';

describe('extractPhrasalVerbBase', () => {
  it('takes the first lexical verb from a two-part phrasal', () => {
    assert.equal(extractPhrasalVerbBase('give up'), 'give');
    assert.equal(extractPhrasalVerbBase('Iron out'), 'iron');
  });

  it('handles longer particles and leading "to"', () => {
    assert.equal(extractPhrasalVerbBase('look forward to'), 'look');
    assert.equal(extractPhrasalVerbBase('to get on with'), 'get');
  });

  it('ignores alternatives after a slash', () => {
    assert.equal(extractPhrasalVerbBase('get up / get down'), 'get');
  });

  it('returns null for blank or non-letter fronts', () => {
    assert.equal(extractPhrasalVerbBase('   '), null);
    assert.equal(extractPhrasalVerbBase('***'), null);
  });
});

describe('ensureVerbTag', () => {
  it('appends verb:{base} and replaces a previous verb tag', () => {
    assert.deepEqual(ensureVerbTag(['topic'], 'give up'), ['topic', 'verb:give']);
    assert.deepEqual(ensureVerbTag(['verb:take', 'topic'], 'give up'), [
      'topic',
      'verb:give',
    ]);
  });

  it('returns null when the front cannot be parsed', () => {
    assert.equal(ensureVerbTag([], '   '), null);
  });
});

describe('resolveVerbGroupKey', () => {
  it('prefers an existing verb tag over reparsing the front', () => {
    assert.deepEqual(resolveVerbGroupKey(['verb:custom'], 'give up'), {
      verbTag: 'verb:custom',
      baseVerb: 'custom',
    });
  });

  it('falls back to parsing the front', () => {
    assert.deepEqual(resolveVerbGroupKey([], 'carry out'), {
      verbTag: buildVerbTag('carry'),
      baseVerb: 'carry',
    });
  });
});
