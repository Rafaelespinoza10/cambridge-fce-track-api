import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { MistakeErrorSubtype, MistakeErrorType } from '@models/enums';
import { buildMistakeRemixContext } from './build-mistake-remix-context';
import type { RemixPlan } from '@lib/mistakes/select-mistake-remix';

function plan(overrides: Partial<RemixPlan> = {}): RemixPlan {
  return {
    targetedCount: 2,
    neutralCount: 1,
    targetPatterns: [
      { errorType: MistakeErrorType.WORD_CLASS, errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, questionCount: 2 },
    ],
    avoidBaseWords: ['RESPONSIBLE'],
    entries: [
      {
        position: 1,
        role: 'targeted',
        targetErrorType: MistakeErrorType.WORD_CLASS,
        targetErrorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
        exampleBaseWord: 'RESPONSIBLE',
        exampleCorrectAnswer: 'responsibly',
      },
      {
        position: 2,
        role: 'neutral',
        targetErrorType: null,
        targetErrorSubtype: null,
        exampleBaseWord: null,
        exampleCorrectAnswer: null,
      },
      {
        position: 3,
        role: 'targeted',
        targetErrorType: MistakeErrorType.WORD_CLASS,
        targetErrorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
        exampleBaseWord: 'RESPONSIBLE',
        exampleCorrectAnswer: 'responsibly',
      },
    ],
    ...overrides,
  };
}

describe('buildMistakeRemixContext', () => {
  it('describes every position with its role', () => {
    const context = buildMistakeRemixContext(plan());
    assert.match(context, /Position 1 \(targeted pattern: adjective_to_adverb\)/);
    assert.match(context, /Position 2 \(neutral \/ control\)/);
    assert.match(context, /Position 3 \(targeted pattern: adjective_to_adverb\)/);
  });

  it('tells the model to use a different word family than the example for targeted positions', () => {
    const context = buildMistakeRemixContext(plan());
    assert.match(context, /"RESPONSIBLE" -> "responsibly"/);
    assert.match(context, /DIFFERENT word family — never that exact word/);
  });

  it('instructs neutral positions to be ordinary and untargeted', () => {
    const context = buildMistakeRemixContext(plan());
    assert.match(context, /ordinary Part 3 item, no targeting/);
    assert.match(context, /plain, untargeted item/);
  });

  it('never hints that some items are targeted and others are not, to the future test-taker reading it', () => {
    const context = buildMistakeRemixContext(plan());
    assert.match(context, /do not hint/);
    assert.match(context, /Never state or hint at the correct answer/);
  });

  it('includes the avoidBaseWords line only when the list is non-empty', () => {
    const withWords = buildMistakeRemixContext(plan());
    assert.match(withWords, /Avoid reusing these recently-failed words.*RESPONSIBLE/);

    const withoutWords = buildMistakeRemixContext(plan({ avoidBaseWords: [] }));
    assert.doesNotMatch(withoutWords, /Avoid reusing these recently-failed words/);
  });

  it('falls back to the errorType label when errorSubtype is null', () => {
    const unclassified = plan({
      entries: [
        {
          position: 1,
          role: 'targeted',
          targetErrorType: MistakeErrorType.UNKNOWN,
          targetErrorSubtype: null,
          exampleBaseWord: null,
          exampleCorrectAnswer: null,
        },
      ],
    });
    const context = buildMistakeRemixContext(unclassified);
    assert.match(context, /targeted pattern: unknown/);
    assert.match(context, /"n\/a" -> "n\/a"/);
  });
});
