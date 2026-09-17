import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { MistakeErrorSubtype, MistakeErrorType } from '@models/enums';
import {
  buildRemixPlan,
  computeTargetedCount,
  MAX_QUESTIONS_PER_PATTERN,
  MAX_REMIX_PATTERNS,
} from './select-mistake-remix';
import type { RemixConceptCandidate, RemixWeaknessPattern } from './select-mistake-remix';

const PART_CODE = 'UOE_PART_3';

function pattern(overrides: Partial<RemixWeaknessPattern> = {}): RemixWeaknessPattern {
  return {
    partCode: PART_CODE,
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    masteryScore: 35,
    lastWrongAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function concept(overrides: Partial<RemixConceptCandidate> = {}): RemixConceptCandidate {
  return {
    partCode: PART_CODE,
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    baseWord: 'RESPONSIBLE',
    correctAnswer: 'responsibly',
    timesWrong: 3,
    ...overrides,
  };
}

describe('computeTargetedCount', () => {
  it('is 5/8 for a Quick (8-question) session', () => {
    assert.equal(computeTargetedCount(8), 5);
  });

  it('is 9/15 for a Challenge (15-question) session', () => {
    assert.equal(computeTargetedCount(15), 9);
  });
});

describe('buildRemixPlan — worked example from the spec', () => {
  it('distributes 2/1/1/1 targeted + 3 neutral across 4 weaknesses of decreasing mastery', () => {
    const patterns = [
      pattern({
        errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
        masteryScore: 35,
        lastWrongAt: new Date('2026-08-04T00:00:00Z'),
      }),
      pattern({
        errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE,
        masteryScore: 48,
        lastWrongAt: new Date('2026-08-03T00:00:00Z'),
      }),
      pattern({
        errorType: MistakeErrorType.SPELLING,
        errorSubtype: MistakeErrorSubtype.SPELLING_CHANGE,
        masteryScore: 58,
        lastWrongAt: new Date('2026-08-02T00:00:00Z'),
      }),
      pattern({
        errorSubtype: MistakeErrorSubtype.VERB_TO_NOUN,
        masteryScore: 63,
        lastWrongAt: new Date('2026-08-01T00:00:00Z'),
      }),
    ];
    const concepts = [
      concept({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, baseWord: 'RESPONSIBLE' }),
      concept({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, baseWord: 'ENCOURAGE' }),
      concept({
        errorType: MistakeErrorType.SPELLING,
        errorSubtype: MistakeErrorSubtype.SPELLING_CHANGE,
        baseWord: 'AVAILABLE',
        correctAnswer: 'availability',
      }),
      concept({ errorSubtype: MistakeErrorSubtype.VERB_TO_NOUN, baseWord: 'DECIDE', correctAnswer: 'decision' }),
    ];

    const plan = buildRemixPlan(patterns, concepts, 8);

    assert.equal(plan.targetedCount, 5);
    assert.equal(plan.neutralCount, 3);
    const byPattern = new Map(
      plan.targetPatterns.map((p) => [`${p.errorType}|${p.errorSubtype}`, p.questionCount]),
    );
    assert.equal(byPattern.get('word_class|adjective_to_adverb'), 2);
    assert.equal(byPattern.get('word_class|noun_to_adjective'), 1);
    assert.equal(byPattern.get('spelling|spelling_change'), 1);
    assert.equal(byPattern.get('word_class|verb_to_noun'), 1);
  });
});

describe('buildRemixPlan — single-weakness fallback', () => {
  it('caps at MAX_QUESTIONS_PER_PATTERN and converts the shortfall to neutral (2 targeted + 6 neutral)', () => {
    const plan = buildRemixPlan([pattern()], [concept()], 8);

    assert.equal(plan.targetedCount, 2);
    assert.equal(plan.neutralCount, 6);
    assert.equal(plan.targetPatterns.length, 1);
    assert.equal(plan.targetPatterns[0].questionCount, 2);
  });
});

describe('buildRemixPlan — zero weaknesses', () => {
  it('degrades to an all-neutral plan rather than throwing', () => {
    const plan = buildRemixPlan([], [], 8);

    assert.equal(plan.targetedCount, 0);
    assert.equal(plan.neutralCount, 8);
    assert.deepEqual(plan.targetPatterns, []);
    assert.ok(plan.entries.every((e) => e.role === 'neutral'));
  });
});

describe('buildRemixPlan — pattern diversity', () => {
  it('never allocates more than MAX_QUESTIONS_PER_PATTERN to a single pattern, even with only 2 weaknesses', () => {
    const patterns = [
      pattern({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, masteryScore: 10 }),
      pattern({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, masteryScore: 90 }),
    ];
    const concepts = [
      concept({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
      concept({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, baseWord: 'ENCOURAGE' }),
    ];

    const plan = buildRemixPlan(patterns, concepts, 8);

    for (const p of plan.targetPatterns) {
      assert.ok(p.questionCount <= MAX_QUESTIONS_PER_PATTERN);
    }
  });

  it('considers at most MAX_REMIX_PATTERNS distinct patterns', () => {
    const subtypes = Object.values(MistakeErrorSubtype);
    const patterns = subtypes.map((errorSubtype, i) =>
      pattern({ errorSubtype, masteryScore: i * 5, lastWrongAt: new Date(2026, 0, i + 1) }),
    );
    const concepts = subtypes.map((errorSubtype) =>
      concept({ errorSubtype, baseWord: `WORD_${errorSubtype}` }),
    );

    const plan = buildRemixPlan(patterns, concepts, 15);

    assert.ok(plan.targetPatterns.length <= MAX_REMIX_PATTERNS);
  });

  it('excludes a pattern with no concept examples available, rather than leaving a slot dangling', () => {
    const patterns = [pattern({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB })];
    const plan = buildRemixPlan(patterns, [], 8);

    assert.equal(plan.targetedCount, 0);
    assert.equal(plan.neutralCount, 8);
  });
});

describe('buildRemixPlan — composition invariant', () => {
  it('targeted + neutral always equals questionCount, for both Quick and Challenge sizes', () => {
    const patterns = [
      pattern({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
      pattern({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE }),
    ];
    const concepts = [
      concept({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
      concept({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, baseWord: 'ENCOURAGE' }),
    ];

    for (const questionCount of [8, 15]) {
      const plan = buildRemixPlan(patterns, concepts, questionCount);
      assert.equal(plan.targetedCount + plan.neutralCount, questionCount);
      assert.equal(plan.entries.length, questionCount);
    }
  });

  it('assigns positions 1..N with no gaps or duplicates', () => {
    const plan = buildRemixPlan(
      [pattern()],
      [concept()],
      8,
    );
    assert.deepEqual(
      plan.entries.map((e) => e.position),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });
});

describe('buildRemixPlan — interleaving', () => {
  it('never blocks all targeted questions first — at least one neutral appears before the last position', () => {
    const patterns = [
      pattern({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, masteryScore: 10 }),
    ];
    const concepts = [concept({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB })];

    const plan = buildRemixPlan(patterns, concepts, 8);
    const firstNeutralIndex = plan.entries.findIndex((e) => e.role === 'neutral');

    assert.ok(firstNeutralIndex >= 0 && firstNeutralIndex < plan.entries.length - 1);
  });

  it('is deterministic — same input produces the same plan every time', () => {
    const patterns = [
      pattern({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, masteryScore: 35 }),
      pattern({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, masteryScore: 48 }),
    ];
    const concepts = [
      concept({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
      concept({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, baseWord: 'ENCOURAGE' }),
    ];

    const first = buildRemixPlan(patterns, concepts, 8);
    const second = buildRemixPlan(patterns, concepts, 8);

    assert.deepEqual(first, second);
  });
});

describe('buildRemixPlan — targeted entries carry the right pattern, neutral entries carry none', () => {
  it('every targeted entry has a non-null targetErrorType/targetErrorSubtype and an example word', () => {
    const plan = buildRemixPlan([pattern()], [concept()], 8);

    for (const entry of plan.entries.filter((e) => e.role === 'targeted')) {
      assert.equal(entry.targetErrorType, MistakeErrorType.WORD_CLASS);
      assert.equal(entry.targetErrorSubtype, MistakeErrorSubtype.ADJECTIVE_TO_ADVERB);
      assert.equal(entry.exampleBaseWord, 'RESPONSIBLE');
    }
  });

  it('every neutral entry has null targetErrorType/targetErrorSubtype/example fields', () => {
    const plan = buildRemixPlan([pattern()], [concept()], 8);

    for (const entry of plan.entries.filter((e) => e.role === 'neutral')) {
      assert.equal(entry.targetErrorType, null);
      assert.equal(entry.targetErrorSubtype, null);
      assert.equal(entry.exampleBaseWord, null);
      assert.equal(entry.exampleCorrectAnswer, null);
    }
  });
});

describe('buildRemixPlan — avoidBaseWords', () => {
  it('collects the base words behind every selected pattern', () => {
    const patterns = [
      pattern({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
      pattern({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, masteryScore: 50 }),
    ];
    const concepts = [
      concept({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, baseWord: 'RESPONSIBLE' }),
      concept({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, baseWord: 'ENCOURAGE' }),
    ];

    const plan = buildRemixPlan(patterns, concepts, 8);

    assert.ok(plan.avoidBaseWords.includes('RESPONSIBLE'));
    assert.ok(plan.avoidBaseWords.includes('ENCOURAGE'));
  });

  it('never includes a base word from a pattern that was not actually selected', () => {
    // MAX_REMIX_PATTERNS = 6, so with 8 distinct subtypes at least 2 are never selected.
    const subtypes = Object.values(MistakeErrorSubtype);
    const patterns = subtypes.map((errorSubtype, i) =>
      pattern({ errorSubtype, masteryScore: i * 5 }),
    );
    const concepts = subtypes.map((errorSubtype, i) =>
      concept({ errorSubtype, baseWord: `WORD_${i}` }),
    );

    const plan = buildRemixPlan(patterns, concepts, 8);
    const selectedSubtypes = new Set(plan.targetPatterns.map((tp) => tp.errorSubtype));
    const excludedWords = concepts
      .filter((c) => !selectedSubtypes.has(c.errorSubtype))
      .map((c) => c.baseWord);

    for (const excludedWord of excludedWords) {
      assert.ok(!plan.avoidBaseWords.includes(excludedWord as string));
    }
    assert.ok(plan.avoidBaseWords.length <= 10);
  });
});
