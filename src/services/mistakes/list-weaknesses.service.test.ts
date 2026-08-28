import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ListWeaknessesService,
  ListWeaknessesError,
  ListWeaknessesErrorCode,
} from './list-weaknesses.service';
import type { MistakeMasteryRepositoryPort } from './list-weaknesses.service';
import type {
  PatternFailureRow,
  PatternRemediationDayRow,
  WeaknessQueryFilters,
} from '@repositories/mistakes/mistake-mastery.repository';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import { MistakeErrorType, MistakeErrorSubtype } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function dayKey(days: number): string {
  return daysAgo(days).toISOString().slice(0, 10);
}

function failure(overrides: Partial<PatternFailureRow> = {}): PatternFailureRow {
  return {
    skill: 'use-of-english',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    timesWrong: 4,
    conceptCount: 2,
    firstSeenAt: daysAgo(30),
    lastWrongAt: daysAgo(10),
    wrongsInRecentWindow: 2,
    ...overrides,
  };
}

function remediation(overrides: Partial<PatternRemediationDayRow> = {}): PatternRemediationDayRow {
  return {
    partCode: 'UOE_PART_3',
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    day: dayKey(2),
    attempts: 4,
    correct: 3,
    families: ['careful'],
    ...overrides,
  };
}

interface Calls {
  failures: Array<{ userId: string; recentWindowStart: Date; filters: WeaknessQueryFilters }>;
  remediation: Array<{ userId: string; timeZone: string }>;
  timeZone: string[];
}

function makeService(
  options: {
    failures?: PatternFailureRow[];
    remediationDays?: PatternRemediationDayRow[];
    timeZone?: string;
  } = {},
): { service: ListWeaknessesService; calls: Calls } {
  const calls: Calls = { failures: [], remediation: [], timeZone: [] };
  const repository: MistakeMasteryRepositoryPort = {
    async findPatternFailures(userId, recentWindowStart, filters) {
      calls.failures.push({ userId, recentWindowStart, filters });
      return options.failures ?? [failure()];
    },
    async findRemediationDays(userId, timeZone) {
      calls.remediation.push({ userId, timeZone });
      return options.remediationDays ?? [];
    },
  };

  const service = new ListWeaknessesService({
    repository,
    resolveTimeZone: async (userId) => {
      calls.timeZone.push(userId);
      return options.timeZone ?? 'America/Mexico_City';
    },
    now: () => NOW,
  });
  return { service, calls };
}

function assertErr(err: unknown, code: ListWeaknessesErrorCode): true {
  assert.ok(err instanceof ListWeaknessesError);
  assert.equal(err.code, code);
  return true;
}

describe('ListWeaknessesService — aggregation', () => {
  it('feeds every remediation day of the same pattern into one weakness', async () => {
    const { service } = makeService({
      failures: [failure({ timesWrong: 5, conceptCount: 4 })],
      remediationDays: [
        remediation({ day: dayKey(5), attempts: 3, correct: 2, families: ['careful'] }),
        remediation({ day: dayKey(3), attempts: 3, correct: 2, families: ['professional'] }),
        remediation({
          day: dayKey(1),
          attempts: 2,
          correct: 2,
          families: ['responsible', 'effective'],
        }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items.length, 1);
    assert.equal(items[0].remediationAttempts, 8);
    assert.equal(items[0].remediationCorrect, 6);
    assert.equal(items[0].distinctBaseWords, 4);
    assert.equal(items[0].distinctPracticeDays, 3);
    assert.equal(items[0].conceptCount, 4);
  });

  it('never lets another subtype contaminate a pattern', async () => {
    const { service } = makeService({
      failures: [
        failure({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
        failure({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, timesWrong: 3 }),
      ],
      remediationDays: [
        remediation({
          errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
          attempts: 6,
          correct: 6,
          families: ['careful', 'professional', 'effective'],
        }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    const adverb = items.find((i) => i.errorSubtype === MistakeErrorSubtype.ADJECTIVE_TO_ADVERB);
    const noun = items.find((i) => i.errorSubtype === MistakeErrorSubtype.NOUN_TO_ADJECTIVE);
    assert.equal(adverb?.remediationAttempts, 6);
    assert.equal(noun?.remediationAttempts, 0);
    assert.equal(noun?.masteryScore, 0);
  });

  it('keeps remediation for the same subtype in a different part apart', async () => {
    const { service } = makeService({
      failures: [failure({ partCode: 'UOE_PART_3' })],
      remediationDays: [remediation({ partCode: 'UOE_PART_4', attempts: 8, correct: 8 })],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].remediationAttempts, 0);
  });

  it('scores an unclassified bucket like any other pattern', async () => {
    const { service } = makeService({
      failures: [
        failure({ errorType: MistakeErrorType.UNKNOWN, errorSubtype: null, timesWrong: 6 }),
      ],
      remediationDays: [
        remediation({
          errorType: MistakeErrorType.UNKNOWN,
          errorSubtype: null,
          attempts: 4,
          correct: 3,
        }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items.length, 1);
    assert.equal(items[0].errorType, MistakeErrorType.UNKNOWN);
    assert.equal(items[0].remediationAttempts, 4);
  });
});

describe('ListWeaknessesService — ordering and shape', () => {
  it('returns the weakest pattern first', async () => {
    const { service } = makeService({
      failures: [
        failure({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, timesWrong: 2 }),
        failure({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADVERB, timesWrong: 9 }),
      ],
      remediationDays: [
        remediation({
          errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
          attempts: 6,
          correct: 6,
          families: ['careful', 'professional', 'effective'],
        }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].errorSubtype, MistakeErrorSubtype.NOUN_TO_ADVERB);
    assert.ok(items[0].masteryScore < items[1].masteryScore);
  });

  it('breaks a tie on the most-failed pattern', async () => {
    const { service } = makeService({
      failures: [
        failure({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, timesWrong: 3 }),
        failure({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADVERB, timesWrong: 11 }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].masteryScore, items[1].masteryScore);
    assert.equal(items[0].timesWrong, 11);
  });

  it('exposes the failure and remediation evidence behind the score', async () => {
    const { service } = makeService({
      failures: [failure({ timesWrong: 7, lastWrongAt: daysAgo(6) })],
      remediationDays: [remediation({ attempts: 4, correct: 3, families: ['careful'] })],
    });

    const { items, totalItems } = await service.execute(USER_ID, {});

    const [item] = items;
    assert.equal(totalItems, 1);
    assert.equal(item.skill, 'use-of-english');
    assert.equal(item.partCode, 'UOE_PART_3');
    assert.equal(item.timesWrong, 7);
    assert.equal(item.lastWrongAt.getTime(), daysAgo(6).getTime());
    assert.ok(item.lastPracticedAt !== null);
    assert.ok(item.masteryScore >= 0 && item.masteryScore <= 100);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'userId'), false);
  });

  it('reports a never-practiced pattern as weak with zero evidence', async () => {
    const { service } = makeService({ failures: [failure()], remediationDays: [] });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].masteryScore, 0);
    assert.equal(items[0].status, MasteryStatus.WEAK);
    assert.equal(items[0].remediationAttempts, 0);
    assert.equal(items[0].lastPracticedAt, null);
  });

  it('returns an empty list when the user has no mistakes at all', async () => {
    const { service } = makeService({ failures: [] });

    const result = await service.execute(USER_ID, {});

    assert.deepEqual(result, { items: [], totalItems: 0 });
  });
});

describe('ListWeaknessesService — ownership', () => {
  it('scopes both reads to the caller and resolves that caller’s timezone', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, {});
    await service.execute(OTHER_USER_ID, {});

    assert.deepEqual(
      calls.failures.map((c) => c.userId),
      [USER_ID, OTHER_USER_ID],
    );
    assert.deepEqual(
      calls.remediation.map((c) => c.userId),
      [USER_ID, OTHER_USER_ID],
    );
    assert.deepEqual(calls.timeZone, [USER_ID, OTHER_USER_ID]);
  });

  it('buckets remediation days in the user’s own timezone', async () => {
    const { service, calls } = makeService({ timeZone: 'Europe/Madrid' });

    await service.execute(USER_ID, {});

    assert.equal(calls.remediation[0].timeZone, 'Europe/Madrid');
  });

  it('rejects a missing userId before touching the repository', async () => {
    const { service, calls } = makeService();

    await assert.rejects(
      () => service.execute('  ', {}),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.INVALID_INPUT),
    );
    assert.equal(calls.failures.length, 0);
  });
});

describe('ListWeaknessesService — filters', () => {
  it('pushes the catalog and classification filters down to the query', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, {
      skill: 'USE_OF_ENGLISH',
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_3',
      errorType: 'word_class',
      errorSubtype: 'adjective_to_adverb',
    });

    assert.deepEqual(calls.failures[0].filters, {
      skill: 'use-of-english',
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    });
  });

  it('applies the status filter after scoring, since status is not stored', async () => {
    const { service, calls } = makeService({
      failures: [
        failure({ errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB }),
        failure({ errorSubtype: MistakeErrorSubtype.NOUN_TO_ADVERB }),
      ],
      remediationDays: [
        remediation({
          errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
          attempts: 6,
          correct: 6,
          families: ['careful', 'professional', 'effective'],
        }),
      ],
    });

    const { items } = await service.execute(USER_ID, { status: 'weak' });

    assert.ok(items.length >= 1);
    assert.ok(items.every((item) => item.status === MasteryStatus.WEAK));
    assert.equal(calls.failures[0].filters.errorType, undefined);
  });

  it('asks the failure query only for the recent-relapse window it needs', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, {});

    const daysBack = (NOW.getTime() - calls.failures[0].recentWindowStart.getTime()) / MS_PER_DAY;
    assert.equal(daysBack, 30);
  });

  it('rejects unknown filter values', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { skill: 'maths' }),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.UNSUPPORTED_SKILL),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { errorType: 'typo' }),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { errorSubtype: 'adjective_to_noun_ish' }),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { status: 'improving' }),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { examCode: 'C2_PROFICIENCY' }),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.UNSUPPORTED_EXAM),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { partCode: 'UOE_PART_3' }),
      (err: unknown) => assertErr(err, ListWeaknessesErrorCode.INVALID_INPUT),
    );
  });
});
