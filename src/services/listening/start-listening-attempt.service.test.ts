import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  StartListeningAttemptService,
  StartListeningAttemptError,
  StartListeningAttemptErrorCode,
} from './start-listening-attempt.service';
import type {
  ListeningSourcesRepositoryPort,
  ListeningAttemptsRepositoryPort,
} from './start-listening-attempt.service';
import type { ListeningAttempt } from '../../models/ListeningAttempt';
import type { ListeningSourceSafeWithItems } from '../../repositories/mocks/listening-sources.repository';
import { ListeningAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '22222222-2222-2222-2222-222222222222';
const STARTED_AT = new Date('2026-01-01T00:00:00.000Z');

const SOURCE_WITH_ITEMS: ListeningSourceSafeWithItems = {
  source: {
    id: SOURCE_ID,
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_4',
    partCode: 'LISTENING_PART_1',
    title: 'A real B2 First Listening test',
    instructions: 'Listen and answer.',
    targetLevel: null,
    videoProvider: 'youtube',
    videoExternalId: 'abc123',
    videoStartSeconds: 0,
    videoEndSeconds: 600,
    status: 'active' as never,
    itemCount: 2,
    createdAt: new Date(),
  },
  items: [
    { id: 'item-1', position: 1, prompt: 'Q1', options: null, skillTags: ['listening'] },
    { id: 'item-2', position: 2, prompt: 'Q2', options: null, skillTags: ['listening'] },
  ],
};

function makeAttempt(overrides: Partial<ListeningAttempt> = {}): ListeningAttempt {
  return {
    id: 'attempt-id',
    user_id: USER_ID,
    source_id: SOURCE_ID,
    status: ListeningAttemptStatus.IN_PROGRESS,
    started_at: STARTED_AT,
    total_count: 2,
    ...overrides,
  } as unknown as ListeningAttempt;
}

interface Overrides {
  findActiveByIdWithItems?: ListeningSourcesRepositoryPort['findActiveByIdWithItems'];
  createAttempt?: ListeningAttemptsRepositoryPort['createAttempt'];
}

function makeService(overrides: Overrides = {}): StartListeningAttemptService {
  const sources: ListeningSourcesRepositoryPort = {
    findActiveByIdWithItems: overrides.findActiveByIdWithItems ?? (async () => SOURCE_WITH_ITEMS),
  };
  const attempts: ListeningAttemptsRepositoryPort = {
    createAttempt:
      overrides.createAttempt ??
      (async (data) => makeAttempt({ source_id: data.sourceId, total_count: data.totalCount })),
  };
  return new StartListeningAttemptService({ sources, attempts });
}

function assertErr(err: unknown, code: StartListeningAttemptErrorCode): true {
  assert.ok(err instanceof StartListeningAttemptError);
  assert.equal(err.code, code);
  return true;
}

describe('StartListeningAttemptService.execute', () => {
  it('creates a fresh attempt and returns items without answer keys', async () => {
    const service = makeService();
    const result = await service.execute(USER_ID, SOURCE_ID, STARTED_AT);
    assert.equal(result.view.attempt.sourceId, SOURCE_ID);
    assert.equal(result.view.attempt.totalCount, 2);
    assert.equal(result.view.items?.length, 2);
    assert.equal(result.view.result, null);
    // No answerKey leaked on the returned items.
    assert.ok(!('answerKey' in (result.view.items?.[0] ?? {})));
  });

  it('allows starting a second attempt even while one is already in progress (no active-attempt lock, unlike Practice)', async () => {
    let createCalls = 0;
    const service = makeService({
      createAttempt: async (data) => {
        createCalls += 1;
        return makeAttempt({ source_id: data.sourceId, total_count: data.totalCount });
      },
    });
    await service.execute(USER_ID, SOURCE_ID, STARTED_AT);
    await service.execute(USER_ID, SOURCE_ID, STARTED_AT);
    assert.equal(createCalls, 2);
  });

  it('rejects an unknown/inactive source', async () => {
    const service = makeService({ findActiveByIdWithItems: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, SOURCE_ID, STARTED_AT),
      (err: unknown) => assertErr(err, StartListeningAttemptErrorCode.SOURCE_NOT_FOUND),
    );
  });

  it('rejects a source with no items', async () => {
    const service = makeService({
      findActiveByIdWithItems: async () => ({ ...SOURCE_WITH_ITEMS, items: [] }),
    });
    await assert.rejects(
      () => service.execute(USER_ID, SOURCE_ID, STARTED_AT),
      (err: unknown) => assertErr(err, StartListeningAttemptErrorCode.SOURCE_NOT_FOUND),
    );
  });

  it('rejects an empty userId', async () => {
    const service = makeService();
    await assert.rejects(
      () => service.execute('', SOURCE_ID, STARTED_AT),
      (err: unknown) => assertErr(err, StartListeningAttemptErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an invalid startedAt', async () => {
    const service = makeService();
    await assert.rejects(
      () => service.execute(USER_ID, SOURCE_ID, new Date('not-a-date')),
      (err: unknown) => assertErr(err, StartListeningAttemptErrorCode.INVALID_INPUT),
    );
  });
});
