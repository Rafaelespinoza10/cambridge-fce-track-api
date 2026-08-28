import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  computeMastery,
  decayWeight,
  toStatus,
  MasteryStatus,
  MASTERY_CONSTANTS,
} from './mastery-score';
import type { PatternEvidence, RemediationDay } from './mastery-score';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' for a local day N days before NOW. */
function daysAgoKey(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function day(
  daysBack: number,
  attempts: number,
  correct: number,
  familiesCorrect: string[] = [],
): RemediationDay {
  return { day: daysAgoKey(daysBack), attempts, correct, familiesCorrect };
}

function evidence(overrides: Partial<PatternEvidence> = {}): PatternEvidence {
  return {
    timesWrong: 0,
    lastWrongAt: null,
    wrongsInRecentWindow: 0,
    remediationDays: [],
    ...overrides,
  };
}

describe('decayWeight', () => {
  it('is 1 at age zero and halves every half-life', () => {
    assert.equal(decayWeight(0, 30), 1);
    assert.equal(decayWeight(30, 30), 0.5);
    assert.equal(decayWeight(60, 30), 0.25);
  });

  it('never treats a future timestamp as worth more than the present', () => {
    assert.equal(decayWeight(-10, 30), 1);
  });
});

describe('computeMastery — a pattern with failures and no remediation', () => {
  it('scores 0 and stays WEAK: failed, never worked on', () => {
    const result = computeMastery(
      evidence({ timesWrong: 7, lastWrongAt: daysAgo(2), wrongsInRecentWindow: 7 }),
      NOW,
    );

    assert.equal(result.score, 0);
    assert.equal(result.status, MasteryStatus.WEAK);
    assert.equal(result.remediationAttempts, 0);
    assert.equal(result.distinctBaseWords, 0);
    assert.equal(result.lastPracticedAt, null);
  });

  it('does not credit a pattern for remediation it never got right', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 4,
        lastWrongAt: daysAgo(1),
        wrongsInRecentWindow: 4,
        remediationDays: [day(0, 4, 0)],
      }),
      NOW,
    );

    assert.equal(result.score, 0);
    assert.equal(result.status, MasteryStatus.WEAK);
  });
});

describe('computeMastery — the worked examples from the plan', () => {
  it('Pattern A (8 attempts, 6 correct, 4 families, 3 days, wrong 6 days ago) is LEARNING', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 5,
        lastWrongAt: daysAgo(6),
        wrongsInRecentWindow: 5,
        remediationDays: [
          day(5, 3, 2, ['careful', 'professional']),
          day(3, 3, 2, ['effective']),
          day(1, 2, 2, ['responsible']),
        ],
      }),
      NOW,
    );

    assert.equal(result.score, 63);
    assert.equal(result.status, MasteryStatus.LEARNING);
    assert.equal(result.remediationAttempts, 8);
    assert.equal(result.remediationCorrect, 6);
    assert.equal(result.distinctBaseWords, 4);
    assert.equal(result.distinctPracticeDays, 3);
  });

  it('Pattern B (3 correct, one word, one day) is only LEARNING — never mastered', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 1,
        lastWrongAt: daysAgo(2),
        wrongsInRecentWindow: 1,
        remediationDays: [day(0, 3, 3, ['responsible'])],
      }),
      NOW,
    );

    assert.equal(result.score, 50);
    assert.equal(result.status, MasteryStatus.LEARNING);
  });
});

describe('computeMastery — evidence moves the score the right way', () => {
  const baseline = evidence({
    timesWrong: 3,
    lastWrongAt: daysAgo(20),
    remediationDays: [day(2, 4, 2, ['careful'])],
  });

  it('correct remediation raises the score', () => {
    const before = computeMastery(baseline, NOW).score;
    const after = computeMastery(
      { ...baseline, remediationDays: [day(2, 4, 4, ['careful'])] },
      NOW,
    ).score;

    assert.ok(after > before, `${after} should beat ${before}`);
  });

  it('a later failure lowers the score', () => {
    const before = computeMastery(baseline, NOW).score;
    const after = computeMastery({ ...baseline, lastWrongAt: daysAgo(1) }, NOW).score;

    assert.ok(after < before, `${after} should be under ${before}`);
  });

  it('the same evidence spread over more lexical families scores higher', () => {
    const oneFamily = computeMastery(
      { ...baseline, remediationDays: [day(2, 6, 6, ['careful'])] },
      NOW,
    ).score;
    const threeFamilies = computeMastery(
      { ...baseline, remediationDays: [day(2, 6, 6, ['careful', 'professional', 'effective'])] },
      NOW,
    ).score;

    assert.ok(threeFamilies > oneFamily, `${threeFamilies} should beat ${oneFamily}`);
  });

  it('the same evidence spread over more days scores higher', () => {
    const oneDay = computeMastery(
      { ...baseline, remediationDays: [day(2, 6, 6, ['careful', 'professional', 'effective'])] },
      NOW,
    ).score;
    const threeDays = computeMastery(
      {
        ...baseline,
        remediationDays: [
          day(4, 2, 2, ['careful']),
          day(3, 2, 2, ['professional']),
          day(2, 2, 2, ['effective']),
        ],
      },
      NOW,
    ).score;

    assert.ok(threeDays > oneDay, `${threeDays} should beat ${oneDay}`);
  });

  it('8/10 correct yesterday is worth clearly more than 8/10 correct 60 days ago', () => {
    const families = ['careful', 'professional', 'effective'];
    const recent = computeMastery(
      evidence({
        timesWrong: 2,
        lastWrongAt: daysAgo(1),
        wrongsInRecentWindow: 2,
        remediationDays: [
          day(3, 4, 3, families),
          day(2, 3, 3, families),
          day(1, 3, 2, families),
        ],
      }),
      NOW,
    );
    const stale = computeMastery(
      evidence({
        timesWrong: 2,
        lastWrongAt: daysAgo(60),
        wrongsInRecentWindow: 0,
        remediationDays: [
          day(62, 4, 3, families),
          day(61, 3, 3, families),
          day(60, 3, 2, families),
        ],
      }),
      NOW,
    );

    assert.ok(
      recent.score > stale.score + 15,
      `recent ${recent.score} should clearly beat stale ${stale.score}`,
    );
  });

  it('keeps the score inside 0..100 for extreme evidence', () => {
    const perfect = computeMastery(
      evidence({
        remediationDays: Array.from({ length: 40 }, (_, i) =>
          day(i, 10, 10, [`family-${i}`]),
        ),
      }),
      NOW,
    );
    const disastrous = computeMastery(
      evidence({
        timesWrong: 999,
        lastWrongAt: NOW,
        wrongsInRecentWindow: 999,
        remediationDays: [day(0, 50, 0)],
      }),
      NOW,
    );

    assert.ok(perfect.score <= 100 && perfect.score >= 0);
    assert.ok(disastrous.score <= 100 && disastrous.score >= 0);
    assert.equal(disastrous.score, 0);
  });
});

describe('computeMastery — statuses', () => {
  it('WEAK for a pattern still failing recently', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 6,
        lastWrongAt: daysAgo(0),
        wrongsInRecentWindow: 6,
        remediationDays: [day(0, 6, 2, ['careful'])],
      }),
      NOW,
    );

    assert.equal(result.status, MasteryStatus.WEAK);
    assert.ok(result.score < MASTERY_CONSTANTS.LEARNING_MIN_SCORE);
  });

  it('STRONG for solid, diverse practice that is still too recent to be mastered', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 3,
        lastWrongAt: daysAgo(12),
        wrongsInRecentWindow: 1,
        remediationDays: [
          day(4, 4, 4, ['careful', 'professional']),
          day(3, 4, 4, ['effective']),
          day(2, 4, 3, ['responsible']),
        ],
      }),
      NOW,
    );

    assert.equal(result.status, MasteryStatus.STRONG);
  });

  it('MASTERED only with a high score, 3+ families, 3+ days and no recent relapse', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 4,
        lastWrongAt: daysAgo(40),
        wrongsInRecentWindow: 0,
        remediationDays: [
          day(6, 4, 4, ['careful', 'professional']),
          day(4, 4, 4, ['effective']),
          day(2, 4, 3, ['responsible', 'successful']),
        ],
      }),
      NOW,
    );

    assert.equal(result.status, MasteryStatus.MASTERED);
    assert.ok(result.score >= MASTERY_CONSTANTS.MASTERED_MIN_SCORE);
    assert.equal(result.masteredBlocked, false);
  });

  it('caps a single-family run below the mastered band, however perfect it is', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 2,
        // Old enough that the failure penalty is gone: the only thing
        // keeping this run out of MASTERED must be the missing families.
        lastWrongAt: daysAgo(200),
        wrongsInRecentWindow: 0,
        remediationDays: [
          day(6, 4, 4, ['responsible']),
          day(4, 4, 4, ['responsible']),
          day(2, 4, 4, ['responsible']),
        ],
      }),
      NOW,
    );

    assert.equal(result.distinctBaseWords, 1);
    assert.equal(result.masteredBlocked, true);
    assert.equal(result.score, MASTERY_CONSTANTS.MASTERED_BLOCKED_MAX_SCORE);
    assert.equal(result.status, MasteryStatus.STRONG);
  });

  it('caps a one-day run below the mastered band', () => {
    const result = computeMastery(
      evidence({
        timesWrong: 2,
        lastWrongAt: daysAgo(200),
        wrongsInRecentWindow: 0,
        remediationDays: [day(1, 12, 12, ['careful', 'professional', 'effective'])],
      }),
      NOW,
    );

    assert.equal(result.distinctPracticeDays, 1);
    assert.equal(result.masteredBlocked, true);
    assert.equal(result.score, MASTERY_CONSTANTS.MASTERED_BLOCKED_MAX_SCORE);
    assert.equal(result.status, MasteryStatus.STRONG);
  });

  it('caps a pattern that relapsed inside the recent window', () => {
    const withRelapse = computeMastery(
      evidence({
        timesWrong: 5,
        lastWrongAt: daysAgo(25),
        wrongsInRecentWindow: 1,
        remediationDays: [
          day(6, 4, 4, ['careful', 'professional']),
          day(4, 4, 4, ['effective']),
          day(2, 4, 4, ['responsible']),
        ],
      }),
      NOW,
    );

    assert.equal(withRelapse.masteredBlocked, true);
    assert.equal(withRelapse.status, MasteryStatus.STRONG);
  });
});

describe('toStatus', () => {
  it('maps each band, and never returns MASTERED without the gates', () => {
    assert.equal(toStatus(0, true), MasteryStatus.WEAK);
    assert.equal(toStatus(39, true), MasteryStatus.WEAK);
    assert.equal(toStatus(40, true), MasteryStatus.LEARNING);
    assert.equal(toStatus(69, true), MasteryStatus.LEARNING);
    assert.equal(toStatus(70, true), MasteryStatus.STRONG);
    assert.equal(toStatus(84, true), MasteryStatus.STRONG);
    assert.equal(toStatus(85, true), MasteryStatus.MASTERED);
    assert.equal(toStatus(100, false), MasteryStatus.STRONG);
  });
});
