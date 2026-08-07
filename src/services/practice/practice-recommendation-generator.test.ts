import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PracticeRecommendationGeneratorAdapter,
  PRACTICE_RECOMMENDATION_PROMPT_VERSION,
} from './practice-recommendation-generator';
import type { PracticeCandidate, StructuredLLM } from './practice-recommendation-generator';
import type { PracticeInsights } from '../../interfaces/practice/practice-adaptive.interface';

const CANDIDATES: PracticeCandidate[] = [
  { examCode: 'B2_FIRST', paperCode: 'PAPER_1', partCode: 'UOE_PART_1' },
];

const INSIGHTS: PracticeInsights = {
  sample: {
    attemptCount: 3,
    itemCount: 15,
    correctCount: 10,
    incorrectCount: 5,
    unansweredCount: 0,
  },
  overall: { percentage: 66.67, averageDurationSeconds: 90 },
  byPart: [
    {
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      code: 'UOE_PART_1',
      itemCount: 15,
      correctCount: 10,
      incorrectCount: 5,
      unansweredCount: 0,
      percentage: 66.67,
    },
  ],
  bySkill: [
    {
      code: 'prepositions',
      itemCount: 8,
      correctCount: 4,
      incorrectCount: 4,
      unansweredCount: 0,
      percentage: 50,
    },
    {
      code: 'collocations',
      itemCount: 7,
      correctCount: 6,
      incorrectCount: 1,
      unansweredCount: 0,
      percentage: 85.71,
    },
  ],
  strengths: ['collocations'],
  focusAreas: ['prepositions'],
  trend: null,
  eligibleForRecommendation: true,
};

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    summary: 'Keep practicing prepositions.',
    strengths: ['collocations'],
    focusAreas: ['prepositions'],
    recommendedPractice: {
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_1',
      reason: 'Weak spot in the last window.',
    },
    studyTips: ['Review common preposition collocations.'],
    ...overrides,
  };
}

function fakeLlm(value: unknown): StructuredLLM {
  return {
    completeStructured: async () => value,
  };
}

describe('PracticeRecommendationGeneratorAdapter', () => {
  it('accepts a valid response referencing only allowed candidates and known skill codes', async () => {
    const adapter = new PracticeRecommendationGeneratorAdapter(fakeLlm(validResponse()));
    const result = await adapter.generate('en', INSIGHTS, CANDIDATES);
    assert.equal(result.recommendedPractice.partCode, 'UOE_PART_1');
  });

  it('rejects a recommendedPractice combination not present in candidates', async () => {
    const adapter = new PracticeRecommendationGeneratorAdapter(
      fakeLlm(
        validResponse({
          recommendedPractice: {
            examCode: 'B2_FIRST',
            paperCode: 'PAPER_1',
            partCode: 'UOE_PART_9',
            reason: 'invented',
          },
        }),
      ),
    );
    await assert.rejects(() => adapter.generate('en', INSIGHTS, CANDIDATES), /AI_INVALID_RESPONSE/);
  });

  it('rejects invented strengths not present in the computed skill metrics', async () => {
    const adapter = new PracticeRecommendationGeneratorAdapter(
      fakeLlm(validResponse({ strengths: ['made-up-skill'] })),
    );
    await assert.rejects(() => adapter.generate('en', INSIGHTS, CANDIDATES), /AI_INVALID_RESPONSE/);
  });

  it('rejects invented focusAreas not present in the computed skill metrics', async () => {
    const adapter = new PracticeRecommendationGeneratorAdapter(
      fakeLlm(validResponse({ focusAreas: ['made-up-skill'] })),
    );
    await assert.rejects(() => adapter.generate('en', INSIGHTS, CANDIDATES), /AI_INVALID_RESPONSE/);
  });

  it('rejects a malformed response missing required fields', async () => {
    const adapter = new PracticeRecommendationGeneratorAdapter(fakeLlm({ summary: 'only this' }));
    await assert.rejects(() => adapter.generate('en', INSIGHTS, CANDIDATES), /AI_INVALID_RESPONSE/);
  });

  it('sends no PII in the context, only deterministic metrics and candidates', async () => {
    let capturedUserContent = '';
    const llm: StructuredLLM = {
      completeStructured: async (messages) => {
        capturedUserContent = messages.find((m) => m.role === 'user')!.content;
        return validResponse();
      },
    };
    const adapter = new PracticeRecommendationGeneratorAdapter(llm);
    await adapter.generate('en', INSIGHTS, CANDIDATES);
    assert.ok(!/@/.test(capturedUserContent), 'must not contain an email address');
    assert.ok(!capturedUserContent.includes('user_id'), 'must not contain a user id field');
    assert.ok(capturedUserContent.includes('prepositions'));
  });

  it('uses the versioned prompt content and requested locale', async () => {
    let capturedUserContent = '';
    let capturedSystemContent = '';
    const llm: StructuredLLM = {
      completeStructured: async (messages) => {
        capturedSystemContent = messages.find((m) => m.role === 'system')!.content;
        capturedUserContent = messages.find((m) => m.role === 'user')!.content;
        return validResponse();
      },
    };
    const adapter = new PracticeRecommendationGeneratorAdapter(llm);
    await adapter.generate('es', INSIGHTS, CANDIDATES);
    assert.ok(capturedUserContent.includes('es'));
    assert.ok(capturedSystemContent.length > 0);
    assert.equal(PRACTICE_RECOMMENDATION_PROMPT_VERSION, 'practice-adaptive-recommendation-v1');
  });
});
