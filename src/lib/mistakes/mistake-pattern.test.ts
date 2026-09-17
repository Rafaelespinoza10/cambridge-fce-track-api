import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildPatternKey } from './mistake-pattern';
import { MistakeErrorType, MistakeErrorSubtype } from '@models/enums';

describe('buildPatternKey', () => {
  it('gives every concept of the same pattern the same key', () => {
    const responsible = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    });
    const professional = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    });

    assert.equal(responsible, professional);
  });

  it('separates a different subtype, so one pattern never absorbs another', () => {
    const toAdverb = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    });
    const toNoun = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_NOUN,
    });

    assert.notEqual(toAdverb, toNoun);
  });

  it('separates the same error type in a different part', () => {
    const part3 = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.SPELLING,
      errorSubtype: null,
    });
    const part2 = buildPatternKey({
      partCode: 'UOE_PART_2',
      errorType: MistakeErrorType.SPELLING,
      errorSubtype: null,
    });

    assert.notEqual(part3, part2);
  });

  it('treats "no subtype" as its own bucket, not as a wildcard', () => {
    const unclassified = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: null,
    });
    const classified = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    });

    assert.equal(unclassified, 'UOE_PART_3|word_class|none');
    assert.notEqual(unclassified, classified);
  });

  it('produces the same key from the mistake side and the remediation side', () => {
    // The mistakes side reads enums off a MistakeConcept; the remediation
    // side reads plain strings out of PracticeItem.metadata. They must agree.
    const fromConcept = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    });
    const fromMetadata = buildPatternKey({
      partCode: 'UOE_PART_3',
      errorType: 'word_class',
      errorSubtype: 'adjective_to_adverb',
    });

    assert.equal(fromConcept, fromMetadata);
  });
});
