import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { MistakeErrorSubtype, MistakeErrorType } from '@models/enums';
import {
  pickDominantTaskType,
  selectDiverseWeaknesses,
  capExplicitSelection,
  buildSlotPlan,
  SelectMistakeWeaknessesError,
  SelectMistakeWeaknessesErrorCode,
  MAX_SELECTION_POOL,
} from './select-mistake-weaknesses';
import type { WeaknessCandidate } from './select-mistake-weaknesses';

let seq = 0;
function candidate(overrides: Partial<WeaknessCandidate> = {}): WeaknessCandidate {
  seq += 1;
  return {
    id: overrides.id ?? `concept-${seq}`,
    taskType: 'word_formation',
    baseWord: 'RESPONSIBLE',
    correctAnswer: 'responsibly',
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    timesWrong: 1,
    lastWrongAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

describe('pickDominantTaskType', () => {
  it('picks the taskType with the highest combined timesWrong', () => {
    const wordFormation = candidate({ taskType: 'word_formation', timesWrong: 5 });
    const openCloze = candidate({ taskType: 'open_cloze', timesWrong: 2 });
    assert.equal(pickDominantTaskType([wordFormation, openCloze]), 'word_formation');
  });

  it('breaks a score tie by the most recent lastWrongAt', () => {
    const older = candidate({
      taskType: 'open_cloze',
      timesWrong: 3,
      lastWrongAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newer = candidate({
      taskType: 'word_formation',
      timesWrong: 3,
      lastWrongAt: new Date('2026-08-01T00:00:00Z'),
    });
    assert.equal(pickDominantTaskType([older, newer]), 'word_formation');
  });

  it('ignores task types Practice My Mistakes cannot generate for (e.g. reading comprehension)', () => {
    const reading = candidate({ taskType: 'multiple_choice', timesWrong: 99 });
    const wordFormation = candidate({ taskType: 'word_formation', timesWrong: 1 });
    assert.equal(pickDominantTaskType([reading, wordFormation]), 'word_formation');
  });

  it('throws NO_ELIGIBLE_MISTAKES when nothing is eligible', () => {
    const reading = candidate({ taskType: 'multiple_choice' });
    const unmapped = candidate({ taskType: null });
    assert.throws(
      () => pickDominantTaskType([reading, unmapped]),
      (err: unknown) =>
        err instanceof SelectMistakeWeaknessesError &&
        err.code === SelectMistakeWeaknessesErrorCode.NO_ELIGIBLE_MISTAKES,
    );
  });
});

describe('selectDiverseWeaknesses', () => {
  it('orders by timesWrong desc, then lastWrongAt desc', () => {
    const low = candidate({ id: 'low', timesWrong: 1, errorSubtype: MistakeErrorSubtype.SUFFIX_ERROR });
    const high = candidate({ id: 'high', timesWrong: 9, errorSubtype: MistakeErrorSubtype.PREFIX_ERROR });
    const selected = selectDiverseWeaknesses([low, high]);
    assert.deepEqual(
      selected.map((c) => c.id),
      ['high', 'low'],
    );
  });

  it('caps how many concepts share the same (errorType, errorSubtype) bucket', () => {
    const bucket = Array.from({ length: 4 }, (_, i) =>
      candidate({ id: `bucket-${i}`, timesWrong: 10 - i, errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
    );
    const other = candidate({ id: 'other', timesWrong: 1, errorSubtype: MistakeErrorSubtype.PREFIX_ERROR });

    const selected = selectDiverseWeaknesses([...bucket, other]);

    const fromBucket = selected.filter((c) => c.errorSubtype === MistakeErrorSubtype.ADJECTIVE_TO_ADVERB);
    assert.equal(fromBucket.length, 2);
    assert.ok(selected.some((c) => c.id === 'other'));
  });

  it('never returns more than poolSize candidates', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: `c-${i}`, errorSubtype: (Object.values(MistakeErrorSubtype) as MistakeErrorSubtype[])[i % 8] }),
    );
    assert.equal(selectDiverseWeaknesses(many).length, MAX_SELECTION_POOL);
  });
});

describe('capExplicitSelection', () => {
  it('keeps every candidate, in priority order, when under the pool size', () => {
    const a = candidate({ id: 'a', timesWrong: 1 });
    const b = candidate({ id: 'b', timesWrong: 5 });
    assert.deepEqual(
      capExplicitSelection([a, b]).map((c) => c.id),
      ['b', 'a'],
    );
  });

  it('never applies a diversity cap — an explicit same-subtype selection stays intact', () => {
    const sameSubtype = Array.from({ length: 4 }, (_, i) => candidate({ id: `s-${i}` }));
    assert.equal(capExplicitSelection(sameSubtype, 10).length, 4);
  });
});

describe('buildSlotPlan', () => {
  it('splits ~25/75 concept-specific/pattern-transfer when a known errorSubtype exists', () => {
    const plan = buildSlotPlan([candidate()], 8);
    assert.equal(plan.conceptSpecificCount, 2);
    assert.equal(plan.patternTransferCount, 6);
    assert.equal(plan.entries.length, 8);
  });

  it('falls back to 100% concept-specific when no selected concept has a known errorSubtype', () => {
    const unclassified = candidate({ errorType: MistakeErrorType.UNKNOWN, errorSubtype: null });
    const plan = buildSlotPlan([unclassified], 8);
    assert.equal(plan.conceptSpecificCount, 8);
    assert.equal(plan.patternTransferCount, 0);
    assert.ok(plan.entries.every((e) => e.practiceMode === 'concept_specific'));
  });

  it('assigns positions 1..N with concept-specific first, pattern-transfer after', () => {
    const plan = buildSlotPlan([candidate()], 8);
    const positions = plan.entries.map((e) => e.position);
    assert.deepEqual(positions, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(
      plan.entries.slice(0, 2).map((e) => e.practiceMode),
      ['concept_specific', 'concept_specific'],
    );
    assert.deepEqual(
      plan.entries.slice(2).map((e) => e.practiceMode),
      Array(6).fill('pattern_transfer'),
    );
  });

  it('pattern-transfer round-robins over DISTINCT errorSubtypes, never one with a null subtype', () => {
    const adjToAdv = candidate({ id: 'a', errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB });
    const prefixErr = candidate({ id: 'b', errorSubtype: MistakeErrorSubtype.PREFIX_ERROR });
    const unclassified = candidate({ id: 'c', errorSubtype: null });

    const plan = buildSlotPlan([adjToAdv, prefixErr, unclassified], 8);
    const patternTargets = plan.entries
      .filter((e) => e.practiceMode === 'pattern_transfer')
      .map((e) => e.targetConceptId);

    assert.ok(patternTargets.every((id) => id === 'a' || id === 'b'));
    assert.ok(patternTargets.includes('a'));
    assert.ok(patternTargets.includes('b'));
  });

  it('records every distinct targeted concept in usedConceptIds', () => {
    const a = candidate({ id: 'a' });
    const b = candidate({ id: 'b', errorSubtype: MistakeErrorSubtype.PREFIX_ERROR });
    const plan = buildSlotPlan([a, b], 8);
    assert.deepEqual(new Set(plan.usedConceptIds), new Set(['a', 'b']));
  });

  it('carries the taskType of the selected candidates', () => {
    const plan = buildSlotPlan([candidate({ taskType: 'key_word_transformation' })], 5);
    assert.equal(plan.taskType, 'key_word_transformation');
  });

  it('throws NO_ELIGIBLE_MISTAKES when given an empty selection', () => {
    assert.throws(
      () => buildSlotPlan([], 8),
      (err: unknown) =>
        err instanceof SelectMistakeWeaknessesError &&
        err.code === SelectMistakeWeaknessesErrorCode.NO_ELIGIBLE_MISTAKES,
    );
  });

  it('never produces a conceptSpecificCount larger than questionCount', () => {
    const plan = buildSlotPlan([candidate()], 5);
    assert.ok(plan.conceptSpecificCount <= 5);
    assert.equal(plan.conceptSpecificCount + plan.patternTransferCount, 5);
  });
});
