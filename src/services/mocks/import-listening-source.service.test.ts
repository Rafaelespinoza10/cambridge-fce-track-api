import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  ImportListeningSourceService,
  ImportListeningSourceError,
  ImportListeningSourceErrorCode,
} from './import-listening-source.service';
import type { ListeningSourcesRepositoryPort } from './import-listening-source.service';
import type {
  ImportListeningSourceInput,
  ImportListeningItemInput,
} from './import-listening-source.service';

const FAKE_DATA_SOURCE = {} as DataSource;

function validItem(position: number): ImportListeningItemInput {
  return {
    position,
    prompt: `Question ${position}`,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ],
    answerKey: { kind: 'single_choice', acceptedOptionIds: ['a'] },
    explanation: 'Because the speaker says so.',
    skillTags: ['detail'],
  };
}

function validInput(
  overrides: Partial<ImportListeningSourceInput> = {},
): ImportListeningSourceInput {
  return {
    paperCode: 'PAPER_3',
    partCode: 'LISTENING_PART_1',
    title: 'Official B2 First Listening Sample Test 1',
    instructions: 'Listen and choose the best answer.',
    targetLevel: null,
    videoExternalId: 'dQw4w9WgXcQ',
    videoStartSeconds: 10,
    videoEndSeconds: 310,
    items: [validItem(1), validItem(2)],
    ...overrides,
  };
}

function makeService() {
  const calls = { createSource: [] as unknown[], createItems: [] as unknown[] };
  const repo: ListeningSourcesRepositoryPort = {
    createSource: async (data) => {
      calls.createSource.push(data);
      return { id: 'source-1', created_at: new Date('2026-01-01T00:00:00Z') };
    },
    createItems: async (sourceId, items) => {
      calls.createItems.push({ sourceId, items });
    },
  };
  const service = new ImportListeningSourceService(FAKE_DATA_SOURCE, {
    listeningSources: () => repo,
  });
  return { service, calls };
}

function assertInvalid(err: unknown): true {
  assert.ok(err instanceof ImportListeningSourceError);
  assert.equal(err.code, ImportListeningSourceErrorCode.INVALID_INPUT);
  return true;
}

describe('ImportListeningSourceService.execute', () => {
  it('persists a valid curated Listening source and its items', async () => {
    const { service, calls } = makeService();
    const result = await service.execute(validInput());

    assert.equal(result.id, 'source-1');
    assert.equal(result.videoExternalId, 'dQw4w9WgXcQ');
    assert.equal(result.itemCount, 2);
    assert.equal(calls.createSource.length, 1);
    assert.equal((calls.createItems[0] as { items: unknown[] }).items.length, 2);
  });

  it('rejects a non-Listening paper', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(validInput({ paperCode: 'PAPER_1', partCode: 'UOE_PART_1' })),
      assertInvalid,
    );
  });

  it('rejects an unknown part code', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(validInput({ partCode: 'LISTENING_PART_99' })),
      assertInvalid,
    );
  });

  it('rejects a blank title', async () => {
    const { service } = makeService();
    await assert.rejects(() => service.execute(validInput({ title: '  ' })), assertInvalid);
  });

  it('rejects videoEndSeconds not greater than videoStartSeconds', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(validInput({ videoStartSeconds: 100, videoEndSeconds: 100 })),
      assertInvalid,
    );
  });

  it('rejects a negative videoStartSeconds', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(validInput({ videoStartSeconds: -1, videoEndSeconds: 10 })),
      assertInvalid,
    );
  });

  it('rejects zero items', async () => {
    const { service } = makeService();
    await assert.rejects(() => service.execute(validInput({ items: [] })), assertInvalid);
  });

  it('rejects item positions with a gap', async () => {
    const { service } = makeService();
    const items = [validItem(1), { ...validItem(2), position: 3 }];
    await assert.rejects(() => service.execute(validInput({ items })), assertInvalid);
  });

  it('rejects an invalid answerKey', async () => {
    const { service } = makeService();
    const items = [{ ...validItem(1), answerKey: { kind: 'bogus' } as never }];
    await assert.rejects(() => service.execute(validInput({ items })), assertInvalid);
  });

  it('rejects more than 20 items', async () => {
    const { service } = makeService();
    const items = Array.from({ length: 21 }, (_, i) => validItem(i + 1));
    await assert.rejects(() => service.execute(validInput({ items })), assertInvalid);
  });
});
