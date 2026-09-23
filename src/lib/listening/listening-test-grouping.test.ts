import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveListeningTestTitle,
  groupListeningSourcesIntoTests,
} from './listening-test-grouping';
import type { ListeningSourceSafeDto } from '../../repositories/mocks/listening-sources.repository';
import { ListeningSourceStatus } from '../../models/enums';

function source(
  overrides: Partial<ListeningSourceSafeDto> &
    Pick<ListeningSourceSafeDto, 'id' | 'partCode' | 'title' | 'videoExternalId'>,
): ListeningSourceSafeDto {
  return {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_3',
    instructions: 'Listen',
    targetLevel: null,
    videoProvider: 'youtube',
    videoStartSeconds: 0,
    videoEndSeconds: 60,
    status: ListeningSourceStatus.ACTIVE,
    itemCount: 5,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('deriveListeningTestTitle', () => {
  it('strips the Part N suffix', () => {
    assert.equal(
      deriveListeningTestTitle(['B2 First Listening — Test 1 Part 2']),
      'B2 First Listening — Test 1',
    );
  });
});

describe('groupListeningSourcesIntoTests', () => {
  it('groups four parts that share a video id', () => {
    const tests = groupListeningSourcesIntoTests([
      source({
        id: 'p2',
        partCode: 'LISTENING_PART_2',
        title: 'B2 First Listening — Test 1 Part 2',
        videoExternalId: 'vid-a',
        itemCount: 8,
      }),
      source({
        id: 'p1',
        partCode: 'LISTENING_PART_1',
        title: 'B2 First Listening — Test 1 Part 1',
        videoExternalId: 'vid-a',
        itemCount: 7,
      }),
      source({
        id: 'other',
        partCode: 'LISTENING_PART_1',
        title: 'B2 First Listening — Test 2 Part 1',
        videoExternalId: 'vid-b',
        itemCount: 6,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ]);

    assert.equal(tests.length, 2);
    assert.equal(tests[0]!.videoExternalId, 'vid-b');
    assert.equal(tests[1]!.id, 'vid-a');
    assert.equal(tests[1]!.title, 'B2 First Listening — Test 1');
    assert.equal(tests[1]!.partCount, 2);
    assert.equal(tests[1]!.totalItemCount, 15);
    assert.deepEqual(
      tests[1]!.parts.map((p) => p.partCode),
      ['LISTENING_PART_1', 'LISTENING_PART_2'],
    );
    assert.equal(tests[1]!.parts[0]!.sourceId, 'p1');
  });
});
