import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isCambridgeSkillSlug,
  isCambridgeTopic,
  isCambridgePaperCode,
  isCambridgePartCode,
} from './cambridge-knowledge-catalog';

describe('isCambridgeSkillSlug', () => {
  it('accepts every real skill slug', () => {
    for (const slug of ['reading', 'use-of-english', 'writing', 'listening', 'speaking']) {
      assert.equal(isCambridgeSkillSlug(slug), true);
    }
  });

  it('rejects an invented skill slug', () => {
    assert.equal(isCambridgeSkillSlug('pronunciation'), false);
    assert.equal(isCambridgeSkillSlug('grammar'), false);
  });
});

describe('isCambridgeTopic', () => {
  it('accepts a topic from the real EXAM_TOPICS bank', () => {
    assert.equal(isCambridgeTopic('travel and tourism'), true);
  });

  it('rejects a topic not in the bank', () => {
    assert.equal(isCambridgeTopic('made up topic nobody wrote'), false);
  });
});

describe('isCambridgePaperCode / isCambridgePartCode — reuse the real, verified PRACTICE_EXAM_CATALOG', () => {
  it('accepts a real B2 First paper code', () => {
    assert.equal(isCambridgePaperCode('PAPER_1'), true);
    assert.equal(isCambridgePaperCode('PAPER_4'), true);
  });

  it('rejects an invented paper code', () => {
    assert.equal(isCambridgePaperCode('PAPER_9'), false);
  });

  it('accepts a real (paperCode, partCode) pair', () => {
    assert.equal(isCambridgePartCode('PAPER_1', 'UOE_PART_1'), true);
    assert.equal(isCambridgePartCode('PAPER_4', 'SPEAKING_PART_2'), true);
  });

  it('rejects a partCode that is real but orphaned from the given paperCode', () => {
    // SPEAKING_PART_2 is real, but only under PAPER_4, never PAPER_1.
    assert.equal(isCambridgePartCode('PAPER_1', 'SPEAKING_PART_2'), false);
  });

  it('rejects an invented partCode', () => {
    assert.equal(isCambridgePartCode('PAPER_1', 'UOE_PART_9'), false);
  });
});
