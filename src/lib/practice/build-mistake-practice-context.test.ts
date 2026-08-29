import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { MistakeErrorSubtype, MistakeErrorType } from '@models/enums';
import { buildMistakePracticeContext } from './build-mistake-practice-context';
import type { MistakeSlotPlan } from '@lib/mistakes/select-mistake-weaknesses';

function plan(overrides: Partial<MistakeSlotPlan> = {}): MistakeSlotPlan {
  return {
    taskType: 'word_formation',
    conceptSpecificCount: 1,
    patternTransferCount: 1,
    usedConceptIds: ['concept-1'],
    entries: [
      {
        position: 1,
        practiceMode: 'concept_specific',
        targetConceptId: 'concept-1',
        targetErrorType: MistakeErrorType.WORD_CLASS,
        targetErrorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
        baseWord: 'RESPONSIBLE',
        correctAnswer: 'responsibly',
      },
      {
        position: 2,
        practiceMode: 'pattern_transfer',
        targetConceptId: 'concept-1',
        targetErrorType: MistakeErrorType.WORD_CLASS,
        targetErrorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
        baseWord: 'RESPONSIBLE',
        correctAnswer: 'responsibly',
      },
    ],
    ...overrides,
  };
}

describe('buildMistakePracticeContext', () => {
  it('describes every position with its practice mode and target pattern', () => {
    const context = buildMistakePracticeContext(plan());
    assert.match(context, /Position 1 \(concept-specific\)/);
    assert.match(context, /Position 2 \(pattern-transfer\)/);
    assert.match(context, /adjective_to_adverb/);
  });

  it('names the base word/correct answer for concept-specific slots, telling the model it may reuse the family', () => {
    const context = buildMistakePracticeContext(plan());
    assert.match(context, /base word "RESPONSIBLE"/);
    assert.match(context, /correct answer "responsibly"/);
    assert.match(context, /may reuse this word family/);
  });

  it('instructs pattern-transfer slots to avoid the original word, never to reuse it', () => {
    const context = buildMistakePracticeContext(plan());
    assert.match(context, /NEW, different word family/);
    assert.match(context, /do not reuse\s+"RESPONSIBLE"/);
  });

  it('falls back to the errorType label when errorSubtype is null', () => {
    const unclassified = plan({
      entries: [
        {
          position: 1,
          practiceMode: 'concept_specific',
          targetConceptId: 'concept-1',
          targetErrorType: MistakeErrorType.UNKNOWN,
          targetErrorSubtype: null,
          baseWord: null,
          correctAnswer: 'quietly',
        },
      ],
    });
    const context = buildMistakePracticeContext(unclassified);
    assert.match(context, /pattern: unknown/);
    // A mistake with no base word is about a form, not a word family — the
    // prompt says so rather than filling the slot with "n/a".
    assert.match(context, /correct form "quietly"/);
    assert.doesNotMatch(context, /base word "/);
  });

  it('always appends the anti-repetition instructions once', () => {
    const context = buildMistakePracticeContext(plan());
    assert.match(context, /Do not reuse the original sentence\./);
    assert.match(context, /Test transfer of the underlying pattern/);
    assert.match(context, /Never state or hint at the correct answer/);
  });
});
