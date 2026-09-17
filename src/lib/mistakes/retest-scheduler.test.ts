import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  RETEST_CONSTANTS,
  RetestResult,
  ReviewTiming,
  addDays,
  gradeRetest,
  initialIntervalDays,
  isEligibleForRetest,
  nextIntervalDays,
  resolveTiming,
  retestItemCount,
} from './retest-scheduler';
import { MasteryStatus } from './mastery-score';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

describe('isEligibleForRetest', () => {
  it('schedules a pattern that is being learned and has been practiced right at least once', () => {
    assert.equal(isEligibleForRetest({ masteryScore: 58, remediationCorrect: 3 }), true);
  });

  it('never schedules a WEAK pattern: nothing was learned, so nothing can be forgotten', () => {
    assert.equal(isEligibleForRetest({ masteryScore: 39, remediationCorrect: 5 }), false);
    assert.equal(isEligibleForRetest({ masteryScore: 0, remediationCorrect: 0 }), false);
  });

  it('never schedules a pattern with no successful remediation, however it scores', () => {
    assert.equal(isEligibleForRetest({ masteryScore: 90, remediationCorrect: 0 }), false);
  });

  it('keeps scheduling a MASTERED pattern — mastered is not permanent', () => {
    assert.equal(isEligibleForRetest({ masteryScore: 92, remediationCorrect: 11 }), true);
  });

  it('treats the LEARNING floor as inclusive', () => {
    assert.equal(isEligibleForRetest({ masteryScore: 40, remediationCorrect: 1 }), true);
  });
});

describe('initialIntervalDays', () => {
  it('gives a longer first interval the better the pattern is known', () => {
    assert.equal(initialIntervalDays(MasteryStatus.LEARNING), 3);
    assert.equal(initialIntervalDays(MasteryStatus.STRONG), 7);
    assert.equal(initialIntervalDays(MasteryStatus.MASTERED), 14);
  });

  it('falls back to a short interval for WEAK, which is unreachable through eligibility', () => {
    assert.equal(initialIntervalDays(MasteryStatus.WEAK), RETEST_CONSTANTS.FAILED_INTERVAL_DAYS);
  });

  it('never starts a pattern above the cap', () => {
    for (const status of Object.values(MasteryStatus)) {
      assert.ok(initialIntervalDays(status) <= RETEST_CONSTANTS.MAX_INTERVAL_DAYS);
    }
  });
});

describe('gradeRetest', () => {
  it('passes a perfect 3-item retest spread over different word families', () => {
    assert.equal(
      gradeRetest({ correctCount: 3, totalCount: 3, distinctCorrectFamilies: 3 }),
      RetestResult.PASS,
    );
  });

  it('downgrades a perfect retest that only ever used one word family', () => {
    // Remembering "responsible -> responsibly" three times is memory of a
    // word, not retention of the pattern.
    assert.equal(
      gradeRetest({ correctCount: 3, totalCount: 3, distinctCorrectFamilies: 1 }),
      RetestResult.PARTIAL,
    );
  });

  it('grades 2 of 3 as partial', () => {
    assert.equal(
      gradeRetest({ correctCount: 2, totalCount: 3, distinctCorrectFamilies: 2 }),
      RetestResult.PARTIAL,
    );
  });

  it('grades 1 of 3 and 0 of 3 as a failure', () => {
    assert.equal(
      gradeRetest({ correctCount: 1, totalCount: 3, distinctCorrectFamilies: 1 }),
      RetestResult.FAIL,
    );
    assert.equal(
      gradeRetest({ correctCount: 0, totalCount: 3, distinctCorrectFamilies: 0 }),
      RetestResult.FAIL,
    );
  });

  it('reads the same way for a 6-item combined session', () => {
    assert.equal(
      gradeRetest({ correctCount: 5, totalCount: 6, distinctCorrectFamilies: 4 }),
      RetestResult.PASS,
    );
    assert.equal(
      gradeRetest({ correctCount: 3, totalCount: 6, distinctCorrectFamilies: 3 }),
      RetestResult.PARTIAL,
    );
    assert.equal(
      gradeRetest({ correctCount: 2, totalCount: 6, distinctCorrectFamilies: 2 }),
      RetestResult.FAIL,
    );
  });

  it('never lets the family gate turn a passing score into a failure', () => {
    assert.equal(
      gradeRetest({ correctCount: 6, totalCount: 6, distinctCorrectFamilies: 0 }),
      RetestResult.PARTIAL,
    );
  });

  it('treats an empty retest as a failure rather than dividing by zero', () => {
    assert.equal(
      gradeRetest({ correctCount: 0, totalCount: 0, distinctCorrectFamilies: 0 }),
      RetestResult.FAIL,
    );
  });
});

describe('nextIntervalDays — PASS', () => {
  it('climbs the ladder one rung at a time', () => {
    const climb = [1, 3, 7, 14].map((currentIntervalDays) =>
      nextIntervalDays({
        currentIntervalDays,
        result: RetestResult.PASS,
        statusAfter: MasteryStatus.STRONG,
      }),
    );
    assert.deepEqual(climb, [3, 7, 14, 30]);
  });

  it('never exceeds the maximum interval', () => {
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 30,
        result: RetestResult.PASS,
        statusAfter: MasteryStatus.MASTERED,
      }),
      RETEST_CONSTANTS.MAX_INTERVAL_DAYS,
    );
  });

  it('snaps an off-ladder interval back onto the ladder before climbing', () => {
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 5,
        result: RetestResult.PASS,
        statusAfter: MasteryStatus.STRONG,
      }),
      14,
    );
  });
});

describe('nextIntervalDays — PARTIAL', () => {
  it('holds the interval: retention was neither confirmed nor lost', () => {
    for (const currentIntervalDays of RETEST_CONSTANTS.INTERVAL_LADDER_DAYS) {
      assert.equal(
        nextIntervalDays({
          currentIntervalDays,
          result: RetestResult.PARTIAL,
          statusAfter: MasteryStatus.LEARNING,
        }),
        currentIntervalDays,
      );
    }
  });
});

describe('nextIntervalDays — FAIL', () => {
  it('brings a long interval straight back to a few days', () => {
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 30,
        result: RetestResult.FAIL,
        statusAfter: MasteryStatus.LEARNING,
      }),
      3,
    );
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 14,
        result: RetestResult.FAIL,
        statusAfter: MasteryStatus.STRONG,
      }),
      3,
    );
  });

  it('retests tomorrow when the failure collapsed the pattern to WEAK', () => {
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 14,
        result: RetestResult.FAIL,
        statusAfter: MasteryStatus.WEAK,
      }),
      1,
    );
  });

  it('never returns an interval outside the ladder, whatever the input', () => {
    for (const result of Object.values(RetestResult)) {
      for (const statusAfter of Object.values(MasteryStatus)) {
        for (const currentIntervalDays of [0, 1, 2, 5, 13, 29, 30, 999]) {
          const next = nextIntervalDays({ currentIntervalDays, result, statusAfter });
          assert.ok(
            (RETEST_CONSTANTS.INTERVAL_LADDER_DAYS as readonly number[]).includes(next),
            `${next} is not a rung (${result}/${statusAfter}/${currentIntervalDays})`,
          );
        }
      }
    }
  });
});

describe('the worked examples from the plan', () => {
  it('B: a STRONG pattern on a 7-day interval that passes moves to 14 days', () => {
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 7,
        result: RetestResult.PASS,
        statusAfter: MasteryStatus.MASTERED,
      }),
      14,
    );
  });

  it('C: a MASTERED pattern on a 14-day interval that fails into LEARNING drops to 3 days', () => {
    assert.equal(
      nextIntervalDays({
        currentIntervalDays: 14,
        result: RetestResult.FAIL,
        statusAfter: MasteryStatus.LEARNING,
      }),
      3,
    );
  });
});

describe('resolveTiming', () => {
  it('is upcoming before the due date', () => {
    assert.equal(resolveTiming(new Date(NOW.getTime() + MS_PER_DAY), NOW), ReviewTiming.UPCOMING);
  });

  it('is due from the moment it comes due', () => {
    assert.equal(resolveTiming(NOW, NOW), ReviewTiming.DUE);
    assert.equal(resolveTiming(new Date(NOW.getTime() - 60_000), NOW), ReviewTiming.DUE);
  });

  it('only counts as overdue after a full day, not one second past midnight', () => {
    assert.equal(
      resolveTiming(new Date(NOW.getTime() - MS_PER_DAY + 1000), NOW),
      ReviewTiming.DUE,
    );
    assert.equal(resolveTiming(new Date(NOW.getTime() - MS_PER_DAY), NOW), ReviewTiming.OVERDUE);
    assert.equal(
      resolveTiming(new Date(NOW.getTime() - 5 * MS_PER_DAY), NOW),
      ReviewTiming.OVERDUE,
    );
  });
});

describe('addDays', () => {
  it('adds whole days in UTC', () => {
    assert.equal(addDays(NOW, 3).toISOString(), '2026-03-04T12:00:00.000Z');
  });

  it('crosses a month boundary without drifting', () => {
    assert.equal(addDays(NOW, 30).toISOString(), '2026-03-31T12:00:00.000Z');
  });
});

describe('retestItemCount', () => {
  it('gives a single pattern a proper 3-item check', () => {
    assert.equal(retestItemCount(1), 3);
    assert.equal(retestItemCount(0), 3);
  });

  it('gives a combined session two items per pattern', () => {
    assert.equal(retestItemCount(2), 4);
    assert.equal(retestItemCount(3), 6);
  });

  it('never grows past a check-up, however many patterns are due', () => {
    assert.equal(retestItemCount(9), 6);
  });
});
