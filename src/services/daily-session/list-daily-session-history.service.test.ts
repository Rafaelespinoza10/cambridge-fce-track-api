import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ListDailySessionHistoryService,
  ListDailySessionHistoryError,
  ListDailySessionHistoryErrorCode,
} from './list-daily-session-history.service';
import type { DailySessionsHistoryRepositoryPort } from './list-daily-session-history.service';
import { DailySessionSubmissionStatus } from '../../models/enums';
import type {
  DailySessionHistoryRow,
  DailySessionHistorySubmissionRawRow,
} from '@repositories/daily-session/daily-sessions.repository';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const SUBMISSION_ID = '22222222-2222-2222-2222-222222222222';
const STARTED_AT = new Date('2026-08-21T11:50:00.000Z');
const SUBMITTED_AT = new Date('2026-08-21T12:00:00.000Z');
const CREATED_AT = new Date('2026-08-21T11:45:00.000Z');

function makeSubmission(
  overrides: Partial<DailySessionHistorySubmissionRawRow> = {},
): DailySessionHistorySubmissionRawRow {
  return {
    submissionId: SUBMISSION_ID,
    dailySessionId: SESSION_ID,
    status: DailySessionSubmissionStatus.GRADED,
    startedAt: STARTED_AT,
    submittedAt: SUBMITTED_AT,
    durationSeconds: 600,
    comprehensionCorrectCount: 4,
    comprehensionTotalCount: 5,
    // numeric(5,2) comes back from pg as a string.
    comprehensionPercentage: '80.00',
    sentenceFeedback: {
      version: 'daily-session-sentence-feedback-v1',
      items: [],
      correctCount: 1,
      totalCount: 2,
    },
    ...overrides,
  };
}

function makeRow(overrides: Partial<DailySessionHistoryRow> = {}): DailySessionHistoryRow {
  return {
    sessionId: SESSION_ID,
    sessionDate: '2026-08-21',
    topic: 'Urban beekeeping',
    readingTitle: 'The Rise of Urban Beekeeping',
    targetLevel: null,
    itemCount: 5,
    createdAt: CREATED_AT,
    submission: makeSubmission(),
    ...overrides,
  };
}

function makeService(
  rows: DailySessionHistoryRow[],
  totalItems: number,
): {
  service: ListDailySessionHistoryService;
  calls: { listHistoryByUser: unknown[] };
} {
  const calls: { listHistoryByUser: unknown[] } = { listHistoryByUser: [] };
  const repository: DailySessionsHistoryRepositoryPort = {
    listHistoryByUser: async (filters) => {
      calls.listHistoryByUser.push(filters);
      return { rows, totalItems };
    },
  };
  return { service: new ListDailySessionHistoryService({ repository }), calls };
}

function assertErr(err: unknown, code: ListDailySessionHistoryErrorCode): true {
  assert.ok(err instanceof ListDailySessionHistoryError);
  assert.equal(err.code, code);
  return true;
}

describe('ListDailySessionHistoryService.execute — mapping', () => {
  it('maps a graded session, normalizing the numeric percentage to a number', async () => {
    const { service } = makeService([makeRow()], 1);
    const result = await service.execute(USER_ID, {});

    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.sessionId, SESSION_ID);
    assert.equal(item.sessionDate, '2026-08-21');
    assert.equal(item.readingTitle, 'The Rise of Urban Beekeeping');
    assert.equal(item.submissionId, SUBMISSION_ID);
    assert.equal(item.submissionStatus, DailySessionSubmissionStatus.GRADED);
    assert.equal(item.comprehensionCorrectCount, 4);
    assert.equal(item.comprehensionTotalCount, 5);
    // A string here would render as "80.00" and break arithmetic on the client.
    assert.equal(item.comprehensionPercentage, 80);
    assert.equal(typeof item.comprehensionPercentage, 'number');
    assert.equal(item.sentenceCorrectCount, 1);
    assert.equal(item.sentenceTotalCount, 2);
  });

  it('nulls every submission field for a session that was never started', async () => {
    const { service } = makeService([makeRow({ submission: null })], 1);
    const result = await service.execute(USER_ID, {});

    const item = result.items[0];
    // The session itself still renders.
    assert.equal(item.readingTitle, 'The Rise of Urban Beekeeping');
    assert.equal(item.submissionId, null);
    assert.equal(item.submissionStatus, null);
    assert.equal(item.startedAt, null);
    assert.equal(item.comprehensionPercentage, null);
    assert.equal(item.sentenceCorrectCount, null);
  });

  it('reports no scores for an in-progress submission, rather than zeros', async () => {
    const inProgress = makeSubmission({
      status: DailySessionSubmissionStatus.IN_PROGRESS,
      submittedAt: null,
      durationSeconds: null,
      comprehensionCorrectCount: null,
      comprehensionTotalCount: null,
      comprehensionPercentage: null,
      sentenceFeedback: null,
    });
    const { service } = makeService([makeRow({ submission: inProgress })], 1);
    const result = await service.execute(USER_ID, {});

    const item = result.items[0];
    // Still surfaced, so the client can offer "resume".
    assert.equal(item.submissionId, SUBMISSION_ID);
    assert.equal(item.submissionStatus, DailySessionSubmissionStatus.IN_PROGRESS);
    assert.equal(item.startedAt?.toISOString(), STARTED_AT.toISOString());
    // 0 would read as "scored zero" on a history card.
    assert.equal(item.comprehensionPercentage, null);
    assert.equal(item.comprehensionCorrectCount, null);
    assert.equal(item.sentenceTotalCount, null);
  });

  it('does not surface stale scores from an abandoned submission', async () => {
    const abandoned = makeSubmission({ status: DailySessionSubmissionStatus.ABANDONED });
    const { service } = makeService([makeRow({ submission: abandoned })], 1);
    const result = await service.execute(USER_ID, {});

    assert.equal(result.items[0].submissionStatus, DailySessionSubmissionStatus.ABANDONED);
    assert.equal(result.items[0].comprehensionPercentage, null);
    assert.equal(result.items[0].comprehensionCorrectCount, null);
  });
});

describe('ListDailySessionHistoryService.execute — pagination', () => {
  it('defaults to page 1 / pageSize 20 and computes totalPages', async () => {
    const { service, calls } = makeService([makeRow()], 45);
    const result = await service.execute(USER_ID, {});

    assert.deepEqual(calls.listHistoryByUser[0], { userId: USER_ID, page: 1, pageSize: 20 });
    assert.equal(result.pagination.page, 1);
    assert.equal(result.pagination.pageSize, 20);
    assert.equal(result.pagination.totalItems, 45);
    assert.equal(result.pagination.totalPages, 3); // ceil(45 / 20)
  });

  it('forwards an explicit page and pageSize', async () => {
    const { service, calls } = makeService([], 100);
    const result = await service.execute(USER_ID, { page: '3', pageSize: '10' });

    assert.deepEqual(calls.listHistoryByUser[0], { userId: USER_ID, page: 3, pageSize: 10 });
    assert.equal(result.pagination.totalPages, 10);
  });

  it('reports zero totalPages for an empty history rather than 1', async () => {
    const { service } = makeService([], 0);
    const result = await service.execute(USER_ID, {});

    assert.equal(result.items.length, 0);
    assert.equal(result.pagination.totalItems, 0);
    assert.equal(result.pagination.totalPages, 0);
  });

  it('rejects a non-numeric or zero page', async () => {
    const { service } = makeService([], 0);
    for (const page of ['abc', '0', '-1', '1.5']) {
      await assert.rejects(
        () => service.execute(USER_ID, { page }),
        (err) => assertErr(err, ListDailySessionHistoryErrorCode.INVALID_INPUT),
      );
    }
  });

  it('rejects a pageSize above the cap that bounds the second query', async () => {
    const { service } = makeService([], 0);
    await assert.rejects(
      () => service.execute(USER_ID, { pageSize: '51' }),
      (err) => assertErr(err, ListDailySessionHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a missing userId', async () => {
    const { service } = makeService([], 0);
    await assert.rejects(
      () => service.execute('   ', {}),
      (err) => assertErr(err, ListDailySessionHistoryErrorCode.INVALID_INPUT),
    );
  });
});
