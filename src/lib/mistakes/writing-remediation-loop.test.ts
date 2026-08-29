import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { buildPatternKey } from './mistake-pattern';
import {
  GENERATABLE_PARTS,
  MISTAKE_PRACTICE_ELIGIBLE_TASK_TYPES,
} from '@lib/practice/generate-practice-exercise-core';
import {
  WRITING_PART_CODE,
  WRITING_REMEDIATION_TASK_TYPE,
} from '../../services/mistakes/record-writing-mistakes.service';
import { MistakeErrorType } from '@models/enums';

/**
 * The Writing loop only closes if three independently-written pieces agree on
 * one thing: the part code a Writing weakness is filed under, and the part
 * code the exercise that repairs it is generated with.
 *
 * Mastery joins remediation evidence to a weakness on
 * `(partCode, errorType, errorSubtype)`. If those two drift apart, nothing
 * errors and nothing looks broken — the evidence simply lands on a pattern
 * key no Writing mistake shares, and every Writing weakness stays at 0
 * forever. This suite is the guard against that silence.
 */
describe('the Writing remediation loop', () => {
  it('generates the repair exercise under the same part the weakness is filed under', () => {
    const part = GENERATABLE_PARTS[WRITING_REMEDIATION_TASK_TYPE];

    assert.ok(part !== undefined, 'sentence_correction must be generatable');
    assert.equal(
      part.partCode,
      WRITING_PART_CODE,
      'a drift here silently stops Writing remediation from ever counting',
    );
  });

  it('produces the identical pattern key from the mistake side and the practice side', () => {
    // What RecordWritingMistakesService writes onto a concept…
    const fromMistake = buildPatternKey({
      partCode: WRITING_PART_CODE,
      errorType: MistakeErrorType.GRAMMAR,
      errorSubtype: null,
    });
    // …and what the mastery query reads back off the generated exercise plus
    // its item metadata.
    const fromRemediation = buildPatternKey({
      partCode: GENERATABLE_PARTS[WRITING_REMEDIATION_TASK_TYPE].partCode,
      errorType: 'grammar',
      errorSubtype: null,
    });

    assert.equal(fromMistake, fromRemediation);
  });

  it('makes a Writing mistake selectable by Practice My Mistakes', () => {
    assert.ok(MISTAKE_PRACTICE_ELIGIBLE_TASK_TYPES.has(WRITING_REMEDIATION_TASK_TYPE));
  });

  it('files every Writing genre under one weakness, by paper rather than by part', () => {
    // Deliberately NOT WRITING_PART_1/WRITING_PART_2: a passive is a passive
    // whether the student wrote an essay or a report, and splitting them
    // would halve the evidence behind every Writing weakness.
    assert.equal(WRITING_PART_CODE, 'WRITING');
    assert.notEqual(WRITING_PART_CODE, 'WRITING_PART_1');
  });

  it('asks for standalone sentences, since a correction exercise has no shared passage', () => {
    const part = GENERATABLE_PARTS[WRITING_REMEDIATION_TASK_TYPE];

    assert.equal(part.requiresStimulus, false);
    assert.equal(part.hasOptions, false);
  });
});
