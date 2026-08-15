import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { ExamType, MockType } from '@models/enums';
import type { SectionScoreInput } from 'src/interfaces';
import { buildSectionData, validateSections } from './mocks-library';

const B2_FIRST_PART_CODES = [
  'uoe-part-1',
  'uoe-part-2',
  'uoe-part-3',
  'uoe-part-4',
  'reading-part-5',
  'reading-part-6',
  'reading-part-7',
  'writing-part-1',
  'writing-part-2',
  'listening-part-1',
  'listening-part-2',
  'listening-part-3',
  'listening-part-4',
  'SPEAKING',
];

function section(code: string, rawScore = 5): SectionScoreInput {
  return { sectionCode: code, rawScore };
}

describe('validateSections — B2_FIRST (part-level)', () => {
  it('accepts a FULL mock with all 14 real parts', () => {
    const sections = B2_FIRST_PART_CODES.map((code) => section(code));
    assert.doesNotThrow(() => validateSections(ExamType.B2_FIRST, MockType.FULL, sections));
  });

  it('rejects a FULL mock missing a part (e.g. only 5 paper-level codes)', () => {
    const sections = ['READING', 'USE_OF_ENGLISH', 'WRITING', 'LISTENING', 'SPEAKING'].map((c) =>
      section(c),
    );
    assert.throws(() => validateSections(ExamType.B2_FIRST, MockType.FULL, sections));
  });

  it('accepts a PARTIAL mock with just one real part', () => {
    const sections = [section('listening-part-2')];
    assert.doesNotThrow(() => validateSections(ExamType.B2_FIRST, MockType.PARTIAL, sections));
  });

  it('accepts a PARTIAL mock with a handful of parts across different skills', () => {
    const sections = [section('uoe-part-1'), section('reading-part-6'), section('SPEAKING')];
    assert.doesNotThrow(() => validateSections(ExamType.B2_FIRST, MockType.PARTIAL, sections));
  });

  it('rejects an unknown section code', () => {
    const sections = [section('listening-part-99')];
    assert.throws(() => validateSections(ExamType.B2_FIRST, MockType.PARTIAL, sections));
  });
});

describe('buildSectionData — B2_FIRST', () => {
  it('resolves a real part max score from the catalog', () => {
    const built = buildSectionData('mock-1', ExamType.B2_FIRST, section('uoe-part-2', 6));
    assert.equal(built.maxScore, 8);
    assert.equal(built.percentage, 75);
  });

  it("resolves Speaking's synthetic 40-point paper total, same as before", () => {
    const built = buildSectionData('mock-1', ExamType.B2_FIRST, section('SPEAKING', 32));
    assert.equal(built.maxScore, 40);
    assert.equal(built.percentage, 80);
  });
});

describe('validateSections — C1_ADVANCED (untouched paper-level flow)', () => {
  it('still requires all 4 papers for a FULL mock', () => {
    const sections = ['READING_AND_USE_OF_ENGLISH', 'WRITING', 'LISTENING', 'SPEAKING'].map((c) =>
      section(c),
    );
    assert.doesNotThrow(() => validateSections(ExamType.C1_ADVANCED, MockType.FULL, sections));
  });

  it('rejects a B2_FIRST-style part code for C1_ADVANCED', () => {
    const sections = [section('uoe-part-1')];
    assert.throws(() => validateSections(ExamType.C1_ADVANCED, MockType.PARTIAL, sections));
  });
});
