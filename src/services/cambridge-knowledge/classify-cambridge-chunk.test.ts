import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CambridgeChunkClassifierAdapter,
  validateClassification,
} from './classify-cambridge-chunk';
import type { LLMServicePort } from './classify-cambridge-chunk';

function fakeLlm(value: unknown): LLMServicePort {
  return { completeStructured: async () => value };
}

describe('validateClassification', () => {
  it('accepts a fully valid classification (real paper/part pair, known skill, known topic)', () => {
    const result = validateClassification({
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      skills: ['use-of-english'],
      topics: ['travel and tourism'],
    });
    assert.deepEqual(result, {
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      skills: ['use-of-english'],
      topics: ['travel and tourism'],
    });
  });

  it('nulls out paperCode when it is not a real Cambridge paper code — never invents one', () => {
    const result = validateClassification({
      paperCode: 'PAPER_9',
      partCode: null,
      skills: [],
      topics: [],
    });
    assert.equal(result.paperCode, null);
  });

  it('nulls out partCode when it does not belong to the given paperCode, even though it is real', () => {
    const result = validateClassification({
      paperCode: 'PAPER_1',
      partCode: 'SPEAKING_PART_2', // real part, but only under PAPER_4
      skills: [],
      topics: [],
    });
    assert.equal(result.paperCode, 'PAPER_1');
    assert.equal(result.partCode, null);
  });

  it('drops (does not invent) skills outside the known slug list', () => {
    const result = validateClassification({
      paperCode: null,
      partCode: null,
      skills: ['reading', 'pronunciation', 'made-up'],
      topics: [],
    });
    assert.deepEqual(result.skills, ['reading']);
  });

  it('drops (does not invent) topics outside the EXAM_TOPICS bank', () => {
    const result = validateClassification({
      paperCode: null,
      partCode: null,
      skills: [],
      topics: ['travel and tourism', 'a topic nobody wrote'],
    });
    assert.deepEqual(result.topics, ['travel and tourism']);
  });

  it('dedupes skills and topics', () => {
    const result = validateClassification({
      paperCode: null,
      partCode: null,
      skills: ['reading', 'reading'],
      topics: ['travel and tourism', 'travel and tourism'],
    });
    assert.deepEqual(result.skills, ['reading']);
    assert.deepEqual(result.topics, ['travel and tourism']);
  });

  it('keeps paperCode null and partCode null when the model says it cannot determine either', () => {
    const result = validateClassification({
      paperCode: null,
      partCode: null,
      skills: [],
      topics: [],
    });
    assert.equal(result.paperCode, null);
    assert.equal(result.partCode, null);
    assert.deepEqual(result.skills, []);
    assert.deepEqual(result.topics, []);
  });

  it('throws on a response that is not even shaped like a classification', () => {
    assert.throws(() => validateClassification({ summary: 'not a classification' }));
    assert.throws(() => validateClassification(null));
    assert.throws(() => validateClassification('a string'));
  });
});

describe('CambridgeChunkClassifierAdapter', () => {
  it('sends the chunk content and page, and returns the validated classification', async () => {
    let capturedUserContent = '';
    const llm: LLMServicePort = {
      completeStructured: async (messages) => {
        capturedUserContent = messages.find((m) => m.role === 'user')!.content;
        return {
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_2',
          skills: ['use-of-english'],
          topics: [],
        };
      },
    };
    const adapter = new CambridgeChunkClassifierAdapter(llm);

    const result = await adapter.classify('Fill in the blank with one word.', 12);

    assert.ok(capturedUserContent.includes('Fill in the blank with one word.'));
    assert.ok(capturedUserContent.includes('12'));
    assert.equal(result.partCode, 'UOE_PART_2');
  });

  it('degrades gracefully (no throw) when the LLM returns an implausible classification', async () => {
    const adapter = new CambridgeChunkClassifierAdapter(
      fakeLlm({
        paperCode: 'NOT_REAL',
        partCode: 'NOT_REAL',
        skills: ['made-up'],
        topics: ['made-up'],
      }),
    );

    const result = await adapter.classify('Some chunk text.', 1);

    assert.equal(result.paperCode, null);
    assert.equal(result.partCode, null);
    assert.deepEqual(result.skills, []);
    assert.deepEqual(result.topics, []);
  });
});
