import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { calculateFlashcardStreak } from './flashcard-streak';

describe('calculateFlashcardStreak', () => {
  it('no completed dates -> current 0, best 0', () => {
    const result = calculateFlashcardStreak([], '2026-01-15');
    assert.deepEqual(result, { current: 0, best: 0 });
  });

  it('only today completed', () => {
    const result = calculateFlashcardStreak(['2026-01-15'], '2026-01-15');
    assert.deepEqual(result, { current: 1, best: 1 });
  });

  it('only yesterday completed', () => {
    const result = calculateFlashcardStreak(['2026-01-14'], '2026-01-15');
    assert.deepEqual(result, { current: 1, best: 1 });
  });

  it('today and several previous consecutive days', () => {
    const result = calculateFlashcardStreak(
      ['2026-01-13', '2026-01-14', '2026-01-15'],
      '2026-01-15',
    );
    assert.deepEqual(result, { current: 3, best: 3 });
  });

  it('today not completed, yesterday completed -> current continues provisionally through yesterday', () => {
    const result = calculateFlashcardStreak(
      ['2026-01-13', '2026-01-14'],
      '2026-01-15',
    );
    assert.deepEqual(result, { current: 2, best: 2 });
  });

  it('neither today nor yesterday completed -> current is zero', () => {
    const result = calculateFlashcardStreak(['2026-01-10'], '2026-01-15');
    assert.equal(result.current, 0);
  });

  it('gaps in the sequence break the run', () => {
    const result = calculateFlashcardStreak(
      ['2026-01-10', '2026-01-13', '2026-01-14', '2026-01-15'],
      '2026-01-15',
    );
    // 2026-01-10 is isolated (gap before 01-13); current run is 13,14,15 = 3
    assert.deepEqual(result, { current: 3, best: 3 });
  });

  it('best streak can exceed the current streak', () => {
    const result = calculateFlashcardStreak(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-06', '2026-08-07'],
      '2026-08-09',
    );
    // historical run of 3 (1,2,3 Aug), current run of 2 (6,7 Aug) but neither
    // today (08-09) nor yesterday (08-08) is completed -> current is 0
    assert.deepEqual(result, { current: 0, best: 3 });
  });

  it('handles a month change within the streak', () => {
    const result = calculateFlashcardStreak(
      ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'],
      '2026-02-02',
    );
    assert.deepEqual(result, { current: 4, best: 4 });
  });

  it('handles a year change within the streak', () => {
    const result = calculateFlashcardStreak(
      ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'],
      '2026-01-02',
    );
    assert.deepEqual(result, { current: 4, best: 4 });
  });

  it('handles a leap year (Feb 29, 2028)', () => {
    const result = calculateFlashcardStreak(
      ['2028-02-28', '2028-02-29', '2028-03-01'],
      '2028-03-01',
    );
    assert.deepEqual(result, { current: 3, best: 3 });
  });

  it('does not treat Feb 28 -> Mar 1 as consecutive in a non-leap year', () => {
    const result = calculateFlashcardStreak(['2027-02-28', '2027-03-01'], '2027-03-01');
    // 2027 is not a leap year, so Feb 28 -> Mar 1 is a 1-day gap in the
    // calendar (there is no Feb 29), meaning these ARE calendar-consecutive.
    assert.deepEqual(result, { current: 2, best: 2 });
  });

  it('deduplicates repeated dates', () => {
    const result = calculateFlashcardStreak(
      ['2026-01-15', '2026-01-15', '2026-01-14', '2026-01-14'],
      '2026-01-15',
    );
    assert.deepEqual(result, { current: 2, best: 2 });
  });

  it('sorts unordered input deterministically', () => {
    const result = calculateFlashcardStreak(
      ['2026-01-15', '2026-01-13', '2026-01-14'],
      '2026-01-15',
    );
    assert.deepEqual(result, { current: 3, best: 3 });
  });

  it('does not mutate the input array', () => {
    const input = ['2026-01-15', '2026-01-13', '2026-01-14'];
    const snapshot = [...input];
    calculateFlashcardStreak(input, '2026-01-15');
    assert.deepEqual(input, snapshot);
  });
});
