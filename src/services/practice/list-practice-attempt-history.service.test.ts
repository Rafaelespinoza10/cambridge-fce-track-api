import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ListPracticeAttemptHistoryService,
  ListPracticeAttemptHistoryError,
  ListPracticeAttemptHistoryErrorCode,
} from './list-practice-attempt-history.service';
import type {
  PracticeAttemptsRepositoryPort,
  ListPracticeAttemptHistoryRawQuery,
} from './list-practice-attempt-history.service';
import type {
  PracticeAttemptHistoryRow,
  ListPracticeAttemptHistoryResult,
} from '../../repositories/practice-attempts.repository';
import { PracticeAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeRow(overrides: Partial<PracticeAttemptHistoryRow> = {}): PracticeAttemptHistoryRow {
  return {
    attemptId: 'attempt-1',
    exerciseId: 'exercise-1',
    status: PracticeAttemptStatus.COMPLETED,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    targetLevel: null,
    title: 'Multiple Choice Cloze',
    itemCount: 8,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    submittedAt: new Date('2026-01-01T00:05:00Z'),
    durationSeconds: 300,
    correctCount: 6,
    totalCount: 8,
    percentage: 75,
    feedbackSummary: {
      version: 'practice-attempt-feedback-v1',
      unansweredCount: 1,
      skillBreakdown: [{ skillTag: 'reading', correctCount: 6, totalCount: 8, percentage: 75 }],
    },
    ...overrides,
  };
}

interface Overrides {
  listHistoryByUser?: PracticeAttemptsRepositoryPort['listHistoryByUser'];
}

function makeService(overrides: Overrides = {}): {
  service: ListPracticeAttemptHistoryService;
  calls: Parameters<PracticeAttemptsRepositoryPort['listHistoryByUser']>[0][];
} {
  const calls: Parameters<PracticeAttemptsRepositoryPort['listHistoryByUser']>[0][] = [];
  const repository: PracticeAttemptsRepositoryPort = {
    listHistoryByUser: async (filters) => {
      calls.push(filters);
      return overrides.listHistoryByUser
        ? overrides.listHistoryByUser(filters)
        : ({ rows: [makeRow()], totalItems: 1 } as ListPracticeAttemptHistoryResult);
    },
  };
  return { service: new ListPracticeAttemptHistoryService({ repository }), calls };
}

function assertErr(err: unknown, code: ListPracticeAttemptHistoryErrorCode): true {
  assert.ok(err instanceof ListPracticeAttemptHistoryError);
  assert.equal(err.code, code);
  return true;
}

async function execute(
  service: ListPracticeAttemptHistoryService,
  query: ListPracticeAttemptHistoryRawQuery = {},
) {
  return service.execute(USER_ID, query);
}

describe('ListPracticeAttemptHistoryService.execute — empty/basic results', () => {
  it('returns an empty page with totalPages:0 when there is no history', async () => {
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [], totalItems: 0 }),
    });
    const result = await execute(service);
    assert.deepEqual(result, {
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
  });

  it('maps a completed attempt row to the history DTO, deriving unansweredCount', async () => {
    const { service } = makeService();
    const result = await execute(service);
    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.attemptId, 'attempt-1');
    assert.equal(item.status, PracticeAttemptStatus.COMPLETED);
    assert.equal(item.unansweredCount, 1);
    assert.equal(item.percentage, 75);
  });

  it('maps an abandoned attempt row with null result fields and null unansweredCount', async () => {
    const abandonedRow = makeRow({
      status: PracticeAttemptStatus.ABANDONED,
      submittedAt: null,
      durationSeconds: null,
      correctCount: null,
      percentage: null,
      feedbackSummary: null,
    });
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [abandonedRow], totalItems: 1 }),
    });
    const result = await execute(service);
    const item = result.items[0];
    assert.equal(item.status, PracticeAttemptStatus.ABANDONED);
    assert.equal(item.submittedAt, null);
    assert.equal(item.correctCount, null);
    assert.equal(item.percentage, null);
    assert.equal(item.unansweredCount, null);
  });
});

describe('ListPracticeAttemptHistoryService.execute — status filter', () => {
  it('defaults to "all" (completed + abandoned) when status is omitted', async () => {
    const { service, calls } = makeService();
    await execute(service, {});
    assert.deepEqual(calls[0].statuses, [
      PracticeAttemptStatus.COMPLETED,
      PracticeAttemptStatus.ABANDONED,
    ]);
  });

  it('never includes in_progress, even under "all"', async () => {
    const { service, calls } = makeService();
    await execute(service, { status: 'all' });
    assert.ok(!calls[0].statuses.includes(PracticeAttemptStatus.IN_PROGRESS as never));
  });

  it('rejects status=in_progress as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { status: 'in_progress' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('filters to only completed when status=completed', async () => {
    const { service, calls } = makeService();
    await execute(service, { status: 'completed' });
    assert.deepEqual(calls[0].statuses, [PracticeAttemptStatus.COMPLETED]);
  });

  it('filters to only abandoned when status=abandoned', async () => {
    const { service, calls } = makeService();
    await execute(service, { status: 'abandoned' });
    assert.deepEqual(calls[0].statuses, [PracticeAttemptStatus.ABANDONED]);
  });

  it('rejects an unrecognized status value', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { status: 'bogus' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });
});

describe('ListPracticeAttemptHistoryService.execute — catalog filters', () => {
  it('forwards a valid examCode filter to the repository', async () => {
    const { service, calls } = makeService();
    await execute(service, { examCode: 'B2_FIRST' });
    assert.equal(calls[0].examCode, 'B2_FIRST');
  });

  it('rejects an unknown examCode as UNSUPPORTED_EXAM', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { examCode: 'NOT_A_REAL_EXAM' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_EXAM),
    );
  });

  it('forwards a valid paperCode filter alongside examCode', async () => {
    const { service, calls } = makeService();
    await execute(service, { examCode: 'B2_FIRST', paperCode: 'PAPER_1' });
    assert.equal(calls[0].paperCode, 'PAPER_1');
  });

  it('rejects paperCode without examCode as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { paperCode: 'PAPER_1' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a paperCode not registered under the given exam as UNSUPPORTED_PAPER', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { examCode: 'B1_PRELIMINARY', paperCode: 'PAPER_1' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PAPER),
    );
  });

  it('forwards a valid partCode filter alongside examCode/paperCode', async () => {
    const { service, calls } = makeService();
    await execute(service, { examCode: 'B2_FIRST', paperCode: 'PAPER_1', partCode: 'UOE_PART_1' });
    assert.equal(calls[0].partCode, 'UOE_PART_1');
  });

  it('rejects partCode without paperCode as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { examCode: 'B2_FIRST', partCode: 'UOE_PART_1' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an invalid examCode/paperCode/partCode combination as UNSUPPORTED_PART', async () => {
    const { service } = makeService();
    // LISTENING_PART_1 belongs to PAPER_3, not PAPER_1 — a real but mismatched combination.
    await assert.rejects(
      () =>
        execute(service, {
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'LISTENING_PART_1',
        }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.UNSUPPORTED_PART),
    );
  });
});

describe('ListPracticeAttemptHistoryService.execute — pagination', () => {
  it('defaults page to 1 and pageSize to 20', async () => {
    const { service, calls } = makeService();
    await execute(service);
    assert.equal(calls[0].page, 1);
    assert.equal(calls[0].pageSize, 20);
  });

  it('rejects a non-numeric page as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { page: 'abc' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects page=0 as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { page: '0' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a negative page as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { page: '-1' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects pageSize=0 as INVALID_INPUT (below the minimum of 1)', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { pageSize: '0' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects pageSize=51 as INVALID_INPUT (above the maximum of 50)', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { pageSize: '51' }),
      (err: unknown) => assertErr(err, ListPracticeAttemptHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('accepts pageSize=50 (the maximum) and forwards it', async () => {
    const { service, calls } = makeService();
    await execute(service, { pageSize: '50' });
    assert.equal(calls[0].pageSize, 50);
  });

  it('accepts pageSize=1 (the minimum) and forwards it', async () => {
    const { service, calls } = makeService();
    await execute(service, { pageSize: '1' });
    assert.equal(calls[0].pageSize, 1);
  });

  it('computes totalPages by ceiling division', async () => {
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [makeRow()], totalItems: 41 }),
    });
    const result = await execute(service, { pageSize: '20' });
    assert.equal(result.pagination.totalItems, 41);
    assert.equal(result.pagination.totalPages, 3);
  });

  it('exposes the requested page/pageSize in the response pagination block', async () => {
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [], totalItems: 0 }),
    });
    const result = await execute(service, { page: '2', pageSize: '10' });
    assert.equal(result.pagination.page, 2);
    assert.equal(result.pagination.pageSize, 10);
  });
});

describe('ListPracticeAttemptHistoryService.execute — safety', () => {
  it('the mapped DTO never carries feedbackSummary/skillBreakdown or other internal fields', async () => {
    const { service } = makeService();
    const result = await execute(service);
    const serialized = JSON.stringify(result.items[0]);
    assert.doesNotMatch(
      serialized,
      /feedbackSummary|skillBreakdown|answerKey|explanation|userId|deletedAt/i,
    );
  });

  it('scopes the query to the given userId', async () => {
    const { service, calls } = makeService();
    await execute(service);
    assert.equal(calls[0].userId, USER_ID);
  });

  it('throws PERSISTENCE_INCONSISTENCY for a completed row missing result fields', async () => {
    const brokenRow = makeRow({ status: PracticeAttemptStatus.COMPLETED, correctCount: null });
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [brokenRow], totalItems: 1 }),
    });
    await assert.rejects(
      () => execute(service),
      (err: unknown) =>
        assertErr(err, ListPracticeAttemptHistoryErrorCode.PERSISTENCE_INCONSISTENCY),
    );
  });
});

// The repository is responsible for normalizing itemCount/durationSeconds/
// correctCount/totalCount/percentage (see practice-attempts.repository.test.ts).
// unansweredCount is different: it comes from the feedbackSummary JSONB blob,
// not a raw SQL column, so its normalization lives here instead. These
// assert typeof, not just value equality — assert.equal('1', 1) would pass
// loosely and hide a stringified field.
describe('ListPracticeAttemptHistoryService.execute — unansweredCount type normalization', () => {
  it('unansweredCount is typeof number for a completed row', async () => {
    const { service } = makeService();
    const result = await execute(service);
    assert.equal(typeof result.items[0].unansweredCount, 'number');
    assert.equal(result.items[0].unansweredCount, 1);
  });

  it('normalizes a stringified unansweredCount to a real number', async () => {
    const row = makeRow({
      feedbackSummary: {
        version: 'practice-attempt-feedback-v1',
        // Simulates a hypothetical JSONB round-trip anomaly — the field is
        // typed `number` everywhere else, so this exercises the defensive
        // conversion path, not a real, expected shape.
        unansweredCount: '2' as unknown as number,
        skillBreakdown: [],
      },
    });
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [row], totalItems: 1 }),
    });
    const result = await execute(service);
    assert.equal(typeof result.items[0].unansweredCount, 'number');
    assert.equal(result.items[0].unansweredCount, 2);
  });

  it('unansweredCount is null (not 0, not "null") for an abandoned row with no feedbackSummary', async () => {
    const abandonedRow = makeRow({
      status: PracticeAttemptStatus.ABANDONED,
      submittedAt: null,
      durationSeconds: null,
      correctCount: null,
      percentage: null,
      feedbackSummary: null,
    });
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [abandonedRow], totalItems: 1 }),
    });
    const result = await execute(service);
    assert.equal(result.items[0].unansweredCount, null);
  });

  it('every numeric-ish field on a completed item is typeof number, not string', async () => {
    const { service } = makeService();
    const result = await execute(service);
    const item = result.items[0];
    for (const field of [
      'itemCount',
      'durationSeconds',
      'correctCount',
      'totalCount',
      'percentage',
      'unansweredCount',
    ] as const) {
      assert.equal(typeof item[field], 'number', `${field} should be typeof number`);
    }
  });
});
