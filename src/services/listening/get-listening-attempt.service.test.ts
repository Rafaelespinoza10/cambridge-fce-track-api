import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GetListeningAttemptService,
  GetListeningAttemptError,
  GetListeningAttemptErrorCode,
} from './get-listening-attempt.service';
import type {
  ListeningAttemptsRepositoryPort,
  ListeningSourcesRepositoryPort,
} from './get-listening-attempt.service';
import type { ListeningAttempt } from '../../models/ListeningAttempt';
import type { ListeningItem } from '../../models/ListeningItem';
import { ListeningAttemptStatus } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '22222222-2222-2222-2222-222222222222';
const ATTEMPT_ID = '33333333-3333-3333-3333-333333333333';

const SAFE_SOURCE = {
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
  itemCount: 1,
  createdAt: new Date(),
};

const SAFE_ITEMS = [{ id: 'item-1', position: 1, prompt: 'Q1', options: null, skillTags: ['listening'] }];

const ITEMS_WITH_KEYS: ListeningItem[] = [
  {
    id: 'item-1',
    source_id: SOURCE_ID,
    position: 1,
    prompt: 'Q1',
    options: null,
    answer_key: { kind: 'text', acceptedAnswers: ['x'], caseSensitive: false },
    explanation: null,
    skill_tags: ['listening'],
  } as unknown as ListeningItem,
];

function makeAttempt(overrides: Partial<ListeningAttempt> = {}): ListeningAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    source_id: SOURCE_ID,
    status: ListeningAttemptStatus.IN_PROGRESS,
    started_at: new Date('2026-01-01T00:00:00Z'),
    submitted_at: null,
    duration_seconds: null,
    correct_count: null,
    total_count: 1,
    percentage: null,
    answers: null,
    feedback_summary: null,
    ...overrides,
  } as unknown as ListeningAttempt;
}

interface Overrides {
  findByIdForUser?: ListeningAttemptsRepositoryPort['findByIdForUser'];
  findByIdWithItems?: ListeningSourcesRepositoryPort['findByIdWithItems'];
  findItemsWithAnswerKeysBySourceId?: ListeningSourcesRepositoryPort['findItemsWithAnswerKeysBySourceId'];
}

function makeService(overrides: Overrides = {}): GetListeningAttemptService {
  const attempts: ListeningAttemptsRepositoryPort = {
    findByIdForUser: overrides.findByIdForUser ?? (async () => makeAttempt()),
  };
  const sources: ListeningSourcesRepositoryPort = {
    findActiveByIdSafe: async () => SAFE_SOURCE,
    findByIdWithItems:
      overrides.findByIdWithItems ?? (async () => ({ source: SAFE_SOURCE, items: SAFE_ITEMS })),
    findItemsWithAnswerKeysBySourceId:
      overrides.findItemsWithAnswerKeysBySourceId ?? (async () => ITEMS_WITH_KEYS),
  };
  return new GetListeningAttemptService({ attempts, sources });
}

describe('GetListeningAttemptService.execute', () => {
  it('returns safe items (no answer key) for an in_progress attempt', async () => {
    const service = makeService();
    const view = await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(view.result, null);
    assert.equal(view.items?.length, 1);
    assert.ok(!('answerKey' in (view.items?.[0] ?? {})));
  });

  it('returns the graded result for a completed attempt', async () => {
    const completedAttempt = makeAttempt({
      status: ListeningAttemptStatus.COMPLETED,
      submitted_at: new Date('2026-01-01T00:05:00Z'),
      duration_seconds: 300,
      correct_count: 1,
      percentage: '100.00',
      answers: [
        {
          itemId: 'item-1',
          answerPayload: { kind: 'text', value: 'x' },
          normalizedAnswer: 'x',
          isCorrect: true,
          responseTimeMs: null,
        },
      ],
      feedback_summary: {
        version: 'listening-attempt-feedback-v1',
        unansweredCount: 0,
        skillBreakdown: [],
      },
    });
    const service = makeService({ findByIdForUser: async () => completedAttempt });
    const view = await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(view.items, null);
    assert.equal(view.result?.correctCount, 1);
    assert.equal(view.result?.items[0]?.isCorrect, true);
  });

  it('rejects an unknown attempt', async () => {
    const service = makeService({ findByIdForUser: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof GetListeningAttemptError);
        assert.equal(err.code, GetListeningAttemptErrorCode.ATTEMPT_NOT_FOUND);
        return true;
      },
    );
  });
});
