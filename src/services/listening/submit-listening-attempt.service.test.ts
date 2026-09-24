import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager } from 'typeorm';

import {
  SubmitListeningAttemptService,
  SubmitListeningAttemptError,
  SubmitListeningAttemptErrorCode,
} from './submit-listening-attempt.service';
import type {
  ListeningAttemptsRepositoryPort,
  ListeningSourcesRepositoryPort,
} from './submit-listening-attempt.service';
import type { ListeningAttempt } from '../../models/ListeningAttempt';
import type { ListeningItem } from '../../models/ListeningItem';
import { ListeningAttemptStatus } from '../../models/enums';

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: EntityManager) => Promise<T>) => work({} as EntityManager),
} as unknown as DataSource;

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_ID = '22222222-2222-2222-2222-222222222222';
const ATTEMPT_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_1 = 'item-1';
const ITEM_2 = 'item-2';
const STARTED_AT = new Date('2026-01-01T00:00:00.000Z');
const SUBMITTED_AT = new Date('2026-01-01T00:05:00.000Z');

const ITEMS: ListeningItem[] = [
  {
    id: ITEM_1,
    source_id: SOURCE_ID,
    position: 1,
    prompt: 'Q1',
    options: [
      { id: 'a', label: 'Option A' },
      { id: 'b', label: 'Option B' },
    ],
    answer_key: { kind: 'single_choice', acceptedOptionIds: ['a'] },
    explanation: null,
    skill_tags: ['listening'],
  } as unknown as ListeningItem,
  {
    id: ITEM_2,
    source_id: SOURCE_ID,
    position: 2,
    prompt: 'Q2',
    options: null,
    answer_key: { kind: 'text', acceptedAnswers: ['forty two'], caseSensitive: false },
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
    started_at: STARTED_AT,
    submitted_at: null,
    duration_seconds: null,
    correct_count: null,
    total_count: 2,
    percentage: null,
    answers: null,
    feedback_summary: null,
    ...overrides,
  } as unknown as ListeningAttempt;
}

interface Overrides {
  findByIdForUser?: ListeningAttemptsRepositoryPort['findByIdForUser'];
  findByIdForUpdate?: ListeningAttemptsRepositoryPort['findByIdForUpdate'];
  completeAttempt?: ListeningAttemptsRepositoryPort['completeAttempt'];
  findItemsWithAnswerKeysBySourceId?: ListeningSourcesRepositoryPort['findItemsWithAnswerKeysBySourceId'];
  findTitleAndPartCodeById?: ListeningSourcesRepositoryPort['findTitleAndPartCodeById'];
}

function makeService(overrides: Overrides = {}): SubmitListeningAttemptService {
  const attempts: ListeningAttemptsRepositoryPort = {
    findByIdForUser: overrides.findByIdForUser ?? (async () => makeAttempt()),
    findByIdForUpdate: overrides.findByIdForUpdate ?? (async () => makeAttempt()),
    completeAttempt: overrides.completeAttempt ?? (async () => ({ affected: 1 })),
  };
  const sources: ListeningSourcesRepositoryPort = {
    findItemsWithAnswerKeysBySourceId:
      overrides.findItemsWithAnswerKeysBySourceId ?? (async () => ITEMS),
    findTitleAndPartCodeById:
      overrides.findTitleAndPartCodeById ??
      (async () => ({ title: 'Test Source', partCode: 'LISTENING_PART_1' })),
  };
  return new SubmitListeningAttemptService(FAKE_DATA_SOURCE, {
    attempts,
    sources,
    // Stubbed for the same reason as the repositories: the real one opens
    // repositories on the transaction's EntityManager, and this suite's
    // manager is a fake. Its own behaviour is covered by
    // create-ai-linked-activity.test.ts / resolve-plan-day-for-date.test.ts.
    createAiLinkedActivity: async () => undefined,
    resolvePlanDayId: async () => 'plan-day-1',
    resolveUserLocalDayKey: async () => '2026-01-01',
  });
}

function assertErr(err: unknown, code: SubmitListeningAttemptErrorCode): true {
  assert.ok(err instanceof SubmitListeningAttemptError);
  assert.equal(err.code, code);
  return true;
}

/** Builds a service whose createAiLinkedActivity calls are observable, unlike makeService's silent stub. */
function makeServiceWithLinkSpy(overrides: Overrides = {}): {
  service: SubmitListeningAttemptService;
  linkCalls: unknown[];
} {
  const linkCalls: unknown[] = [];
  const attempts: ListeningAttemptsRepositoryPort = {
    findByIdForUser: overrides.findByIdForUser ?? (async () => makeAttempt()),
    findByIdForUpdate: overrides.findByIdForUpdate ?? (async () => makeAttempt()),
    completeAttempt: overrides.completeAttempt ?? (async () => ({ affected: 1 })),
  };
  const sources: ListeningSourcesRepositoryPort = {
    findItemsWithAnswerKeysBySourceId:
      overrides.findItemsWithAnswerKeysBySourceId ?? (async () => ITEMS),
    findTitleAndPartCodeById:
      overrides.findTitleAndPartCodeById ??
      (async () => ({ title: 'Test Source', partCode: 'LISTENING_PART_1' })),
  };
  const service = new SubmitListeningAttemptService(FAKE_DATA_SOURCE, {
    attempts,
    sources,
    createAiLinkedActivity: async (_manager, input) => {
      linkCalls.push(input);
    },
    resolvePlanDayId: async () => 'plan-day-1',
    resolveUserLocalDayKey: async () => '2026-01-01',
  });
  return { service, linkCalls };
}

describe('SubmitListeningAttemptService.execute', () => {
  it('grades a mix of correct/incorrect/unanswered items and completes the attempt', async () => {
    let completed: unknown = null;
    const service = makeService({
      completeAttempt: async (attemptId, userId, data) => {
        completed = { attemptId, userId, data };
        return { affected: 1 };
      },
    });

    const { result, idempotentReplay } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [
        { itemId: ITEM_1, answer: { kind: 'single_choice', optionId: 'a' } },
        { itemId: ITEM_2, answer: { kind: 'text', value: 'Forty Two' } },
      ],
      SUBMITTED_AT,
    );

    assert.equal(idempotentReplay, false);
    assert.equal(result.correctCount, 2);
    assert.equal(result.totalCount, 2);
    assert.equal(result.percentage, 100);
    assert.equal(result.durationSeconds, 300);
    assert.ok(completed !== null);
  });

  it('marks an omitted item as unanswered/incorrect', async () => {
    const service = makeService();
    const { result } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [{ itemId: ITEM_1, answer: { kind: 'single_choice', optionId: 'b' } }],
      SUBMITTED_AT,
    );
    assert.equal(result.correctCount, 0);
    const item2 = result.items.find((i) => i.itemId === ITEM_2);
    assert.equal(item2?.userAnswer.kind, 'unanswered');
    assert.equal(item2?.isCorrect, false);
  });

  it('replays a completed attempt idempotently without re-grading', async () => {
    let completeCalls = 0;
    const completedAttempt = makeAttempt({
      status: ListeningAttemptStatus.COMPLETED,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 300,
      correct_count: 2,
      percentage: '100.00',
      answers: [
        {
          itemId: ITEM_1,
          answerPayload: { kind: 'single_choice', optionId: 'a' },
          normalizedAnswer: 'a',
          isCorrect: true,
          responseTimeMs: null,
        },
        {
          itemId: ITEM_2,
          answerPayload: { kind: 'text', value: 'forty two' },
          normalizedAnswer: 'forty two',
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
    const service = makeService({
      findByIdForUser: async () => completedAttempt,
      completeAttempt: async () => {
        completeCalls += 1;
        return { affected: 1 };
      },
    });

    const { idempotentReplay, result } = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [{ itemId: ITEM_1, answer: { kind: 'single_choice', optionId: 'b' } }],
      SUBMITTED_AT,
    );
    assert.equal(idempotentReplay, true);
    assert.equal(completeCalls, 0);
    assert.equal(result.correctCount, 2);
  });

  it('registers a completed attempt as an AI-linked planned activity, same as Practice/Writing', async () => {
    const { service, linkCalls } = makeServiceWithLinkSpy();

    await service.execute(
      USER_ID,
      ATTEMPT_ID,
      [{ itemId: ITEM_1, answer: { kind: 'single_choice', optionId: 'a' } }],
      SUBMITTED_AT,
    );

    assert.equal(linkCalls.length, 1);
    const input = linkCalls[0] as Record<string, unknown>;
    assert.equal(input.listeningAttemptId, ATTEMPT_ID);
    assert.equal(input.skillSlug, 'listening');
    assert.equal(input.title, 'Listening — Test Source');
    assert.equal(input.examSectionSlug, 'listening-part-1');
    assert.equal(input.planDayId, 'plan-day-1');
    assert.equal(input.practiceAttemptId, undefined);
    assert.equal(input.writingSubmissionId, undefined);
    assert.equal(input.dailySessionSubmissionId, undefined);
  });

  it('does not register a planned activity on an idempotent replay', async () => {
    const completedAttempt = makeAttempt({
      status: ListeningAttemptStatus.COMPLETED,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 300,
      correct_count: 2,
      percentage: '100.00',
      answers: [
        {
          itemId: ITEM_1,
          answerPayload: { kind: 'single_choice', optionId: 'a' },
          normalizedAnswer: 'a',
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
    const { service, linkCalls } = makeServiceWithLinkSpy({
      findByIdForUser: async () => completedAttempt,
    });

    await service.execute(USER_ID, ATTEMPT_ID, [], SUBMITTED_AT);

    assert.equal(linkCalls.length, 0);
  });

  it('rejects an unknown attempt', async () => {
    const service = makeService({ findByIdForUser: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, [], SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitListeningAttemptErrorCode.ATTEMPT_NOT_FOUND),
    );
  });

  it('rejects an answer for an item outside this source', async () => {
    const service = makeService();
    await assert.rejects(
      () =>
        service.execute(
          USER_ID,
          ATTEMPT_ID,
          [{ itemId: 'not-a-real-item', answer: { kind: 'text', value: 'x' } }],
          SUBMITTED_AT,
        ),
      (err: unknown) => assertErr(err, SubmitListeningAttemptErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a duplicate answer for the same item', async () => {
    const service = makeService();
    await assert.rejects(
      () =>
        service.execute(
          USER_ID,
          ATTEMPT_ID,
          [
            { itemId: ITEM_1, answer: { kind: 'single_choice', optionId: 'a' } },
            { itemId: ITEM_1, answer: { kind: 'single_choice', optionId: 'b' } },
          ],
          SUBMITTED_AT,
        ),
      (err: unknown) => assertErr(err, SubmitListeningAttemptErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a malformed answer payload', async () => {
    const service = makeService();
    await assert.rejects(
      () =>
        service.execute(
          USER_ID,
          ATTEMPT_ID,
          [{ itemId: ITEM_1, answer: { kind: 'bogus' } }],
          SUBMITTED_AT,
        ),
      (err: unknown) => assertErr(err, SubmitListeningAttemptErrorCode.INVALID_INPUT),
    );
  });
});
