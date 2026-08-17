import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ListWritingSubmissionHistoryService,
  ListWritingSubmissionHistoryError,
  ListWritingSubmissionHistoryErrorCode,
} from './list-writing-submission-history.service';
import type {
  WritingSubmissionsRepositoryPort,
  ListWritingSubmissionHistoryRawQuery,
} from './list-writing-submission-history.service';
import type {
  WritingSubmissionHistoryRow,
  ListHistoryResult,
} from '../../repositories/writing-submissions.repository';
import { WritingSubmissionStatus, WritingTaskType } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makeRow(
  overrides: Partial<WritingSubmissionHistoryRow> = {},
): WritingSubmissionHistoryRow {
  return {
    submissionId: 'submission-1',
    taskId: 'task-1',
    taskType: WritingTaskType.ESSAY,
    title: 'Technology in education',
    status: WritingSubmissionStatus.GRADED,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    submittedAt: new Date('2026-01-01T00:40:00Z'),
    durationSeconds: 2400,
    wordCount: 175,
    overallBand: 16,
    maxBand: 20,
    ...overrides,
  };
}

interface Overrides {
  listHistoryByUser?: WritingSubmissionsRepositoryPort['listHistoryByUser'];
}

function makeService(overrides: Overrides = {}): {
  service: ListWritingSubmissionHistoryService;
  calls: Parameters<WritingSubmissionsRepositoryPort['listHistoryByUser']>[0][];
} {
  const calls: Parameters<WritingSubmissionsRepositoryPort['listHistoryByUser']>[0][] = [];
  const repository: WritingSubmissionsRepositoryPort = {
    listHistoryByUser: async (filters) => {
      calls.push(filters);
      return overrides.listHistoryByUser
        ? overrides.listHistoryByUser(filters)
        : ({ rows: [makeRow()], totalItems: 1 } as ListHistoryResult);
    },
  };
  return { service: new ListWritingSubmissionHistoryService({ repository }), calls };
}

function assertErr(err: unknown, code: ListWritingSubmissionHistoryErrorCode): true {
  assert.ok(err instanceof ListWritingSubmissionHistoryError);
  assert.equal(err.code, code);
  return true;
}

async function execute(
  service: ListWritingSubmissionHistoryService,
  query: ListWritingSubmissionHistoryRawQuery = {},
) {
  return service.execute(USER_ID, query);
}

describe('ListWritingSubmissionHistoryService.execute — empty/basic results', () => {
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

  it('maps a graded submission row to the history DTO', async () => {
    const { service } = makeService();
    const result = await execute(service);
    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.submissionId, 'submission-1');
    assert.equal(item.taskType, WritingTaskType.ESSAY);
    assert.equal(item.status, WritingSubmissionStatus.GRADED);
    assert.equal(item.overallBand, 16);
    assert.equal(item.maxBand, 20);
  });

  it('maps an abandoned row with null result fields', async () => {
    const abandonedRow = makeRow({
      status: WritingSubmissionStatus.ABANDONED,
      submittedAt: null,
      durationSeconds: null,
      wordCount: null,
      overallBand: null,
      maxBand: null,
    });
    const { service } = makeService({
      listHistoryByUser: async () => ({ rows: [abandonedRow], totalItems: 1 }),
    });
    const result = await execute(service);
    const item = result.items[0];
    assert.equal(item.status, WritingSubmissionStatus.ABANDONED);
    assert.equal(item.submittedAt, null);
    assert.equal(item.overallBand, null);
  });
});

describe('ListWritingSubmissionHistoryService.execute — status filter', () => {
  it('defaults to "all" (graded + abandoned) when status is omitted', async () => {
    const { service, calls } = makeService();
    await execute(service, {});
    assert.deepEqual(calls[0].statuses, [
      WritingSubmissionStatus.GRADED,
      WritingSubmissionStatus.ABANDONED,
    ]);
  });

  it('never includes in_progress, even under "all"', async () => {
    const { service, calls } = makeService();
    await execute(service, { status: 'all' });
    assert.ok(!calls[0].statuses.includes(WritingSubmissionStatus.IN_PROGRESS as never));
  });

  it('rejects status=in_progress as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { status: 'in_progress' }),
      (err: unknown) => assertErr(err, ListWritingSubmissionHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('filters to only graded when status=graded', async () => {
    const { service, calls } = makeService();
    await execute(service, { status: 'graded' });
    assert.deepEqual(calls[0].statuses, [WritingSubmissionStatus.GRADED]);
  });

  it('filters to only abandoned when status=abandoned', async () => {
    const { service, calls } = makeService();
    await execute(service, { status: 'abandoned' });
    assert.deepEqual(calls[0].statuses, [WritingSubmissionStatus.ABANDONED]);
  });

  it('rejects an unrecognized status value', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { status: 'bogus' }),
      (err: unknown) => assertErr(err, ListWritingSubmissionHistoryErrorCode.INVALID_INPUT),
    );
  });
});

describe('ListWritingSubmissionHistoryService.execute — pagination', () => {
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
      (err: unknown) => assertErr(err, ListWritingSubmissionHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects page=0 as INVALID_INPUT', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { page: '0' }),
      (err: unknown) => assertErr(err, ListWritingSubmissionHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('rejects pageSize=51 as INVALID_INPUT (above the maximum of 50)', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => execute(service, { pageSize: '51' }),
      (err: unknown) => assertErr(err, ListWritingSubmissionHistoryErrorCode.INVALID_INPUT),
    );
  });

  it('accepts pageSize=50 (the maximum) and forwards it', async () => {
    const { service, calls } = makeService();
    await execute(service, { pageSize: '50' });
    assert.equal(calls[0].pageSize, 50);
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

describe('ListWritingSubmissionHistoryService.execute — safety', () => {
  it('the mapped DTO never carries submittedText/feedback or other internal fields', async () => {
    const { service } = makeService();
    const result = await execute(service);
    const serialized = JSON.stringify(result.items[0]);
    assert.doesNotMatch(
      serialized,
      /submittedText|feedback|criteria|corrections|userId|deletedAt/i,
    );
  });

  it('scopes the query to the given userId', async () => {
    const { service, calls } = makeService();
    await execute(service);
    assert.equal(calls[0].userId, USER_ID);
  });

  it('reports every generatable task type correctly (Part 1 and Part 2)', async () => {
    for (const taskType of Object.values(WritingTaskType)) {
      const { service } = makeService({
        listHistoryByUser: async () => ({ rows: [makeRow({ taskType })], totalItems: 1 }),
      });
      const result = await execute(service);
      assert.equal(result.items[0].taskType, taskType);
    }
  });
});
