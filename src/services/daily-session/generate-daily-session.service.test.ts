import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  GenerateDailySessionService,
  GenerateDailySessionError,
  GenerateDailySessionErrorCode,
} from './generate-daily-session.service';
import type {
  LLMServicePort,
  UsersRepositoryPort,
  DailySessionsRepositoryPort,
  SearchKnowledgePort,
} from './generate-daily-session.service';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import type {
  CreateSessionData,
  CreateItemData,
} from '@repositories/daily-session/daily-sessions.repository';
import type { DailySession } from '../../models/DailySession';
import type { User } from '../../models/User';
import type { DailySessionSafeWithItems } from '../../interfaces/daily-session/daily-session.interface';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const REQUESTED_AT = new Date('2026-08-21T10:00:00.000Z');

function mcqItem(position: number) {
  return {
    position,
    prompt: `What does the passage say about point ${position}?`,
    options: [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'gamma' },
      { id: 'd', label: 'delta' },
    ],
    answerKey: { kind: 'single_choice', acceptedOptionIds: ['a'] },
    explanation: 'The passage states this directly in paragraph 2.',
    skillTags: ['detail'],
  };
}

function validGeneratedSession() {
  return {
    readingTitle: 'The Rise of Urban Beekeeping',
    readingInstructions: 'Read the passage and answer the questions.',
    readingPassage: 'Urban beekeeping has grown steadily over the last decade...',
    items: Array.from({ length: 5 }, (_, i) => mcqItem(i + 1)),
    sentenceTaskInstructions: 'Write one sentence using each target word or phrase.',
    sentenceTargets: [
      { targetText: 'thrive', hint: 'verb — to grow or develop successfully' },
      { targetText: 'sustainable', hint: 'adjective — able to continue over time' },
      { targetText: 'in the long run', hint: 'phrase — over an extended period' },
    ],
  };
}

const SAFE_RESULT: DailySessionSafeWithItems = {
  session: {
    id: 'session-id',
    sessionDate: '2026-08-21',
    targetLevel: null,
    topic: 'the environment and climate change',
    readingTitle: 't',
    readingInstructions: 'i',
    readingPassage: 'p',
    itemCount: 5,
    sentenceTaskInstructions: 's',
    sentenceTargets: [],
    createdAt: new Date(),
  },
  items: [],
};

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: never) => Promise<T>) => work({} as never),
} as unknown as DataSource;

const USER_WITH_TIMEZONE: User = {
  id: USER_ID,
  profile: { timezone: 'America/Mexico_City' },
} as unknown as User;

interface RepoCalls {
  createSession: CreateSessionData[];
  createItems: { sessionId: string; items: CreateItemData[] }[];
  findByUserAndSessionDate: { userId: string; sessionDate: string }[];
}

interface MakeServiceOverrides {
  user?: User | null;
  findSafeSessionForUser?: () => Promise<DailySessionSafeWithItems | null>;
  findByUserAndSessionDate?: (userId: string, sessionDate: string) => Promise<DailySession | null>;
  createSession?: (data: CreateSessionData) => Promise<DailySession>;
  searchKnowledge?: SearchKnowledgePort;
}

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
  overrides: MakeServiceOverrides = {},
): { service: GenerateDailySessionService; calls: RepoCalls; llmCallCount: () => number } {
  const calls: RepoCalls = { createSession: [], createItems: [], findByUserAndSessionDate: [] };
  let llmCalls = 0;
  const llm: LLMServicePort = {
    completeStructured: async (...args) => {
      llmCalls += 1;
      return completeStructured(...args);
    },
  };
  const users = (): UsersRepositoryPort => ({
    findUserWithProfile: async () =>
      overrides.user === undefined ? USER_WITH_TIMEZONE : overrides.user,
  });
  const dailySessions = (): DailySessionsRepositoryPort => ({
    createSession: async (data) => {
      calls.createSession.push(data);
      if (overrides.createSession) return overrides.createSession(data);
      return { id: 'session-id' } as DailySession;
    },
    createItems: async (sessionId, items) => {
      calls.createItems.push({ sessionId, items });
      return [];
    },
    findSafeSessionForUser: overrides.findSafeSessionForUser ?? (async () => SAFE_RESULT),
    findByUserAndSessionDate: async (userId, sessionDate) => {
      calls.findByUserAndSessionDate.push({ userId, sessionDate });
      if (overrides.findByUserAndSessionDate)
        return overrides.findByUserAndSessionDate(userId, sessionDate);
      return null;
    },
  });
  const service = new GenerateDailySessionService(FAKE_DATA_SOURCE, {
    llm,
    providerLabel: 'openai',
    modelLabel: 'gpt-5.6-terra',
    users,
    dailySessions,
    searchKnowledge: overrides.searchKnowledge,
  });
  return { service, calls, llmCallCount: () => llmCalls };
}

function assertGenErr(err: unknown, code: GenerateDailySessionErrorCode): true {
  assert.ok(err instanceof GenerateDailySessionError);
  assert.equal(err.code, code);
  return true;
}

// ── happy path ───────────────────────────────────────────────────────────────

describe('GenerateDailySessionService.execute — happy path', () => {
  it('generates and persists a session for today, resolving sessionDate from the profile timezone', async () => {
    const { service, calls } = makeService(async () => validGeneratedSession());
    await service.execute(USER_ID, REQUESTED_AT);

    assert.equal(calls.createSession.length, 1);
    assert.equal(calls.createSession[0]?.userId, USER_ID);
    assert.equal(calls.createSession[0]?.timezone, 'America/Mexico_City');
    // 2026-08-21T10:00:00Z is still the 21st in America/Mexico_City (UTC-6/-5).
    assert.equal(calls.createSession[0]?.sessionDate, '2026-08-21');
    assert.equal(calls.createItems[0]?.items.length, 5);
    assert.equal(calls.createSession[0]?.sentenceTargets.length, 3);
  });

  it('defaults to UTC when the user has no profile timezone set', async () => {
    const { service, calls } = makeService(async () => validGeneratedSession(), {
      user: { id: USER_ID, profile: { timezone: null } } as unknown as User,
    });
    await service.execute(USER_ID, REQUESTED_AT);
    assert.equal(calls.createSession[0]?.timezone, 'UTC');
  });

  it('rejects an invalid IANA timezone stored on the profile', async () => {
    const { service } = makeService(async () => validGeneratedSession(), {
      user: { id: USER_ID, profile: { timezone: 'Not/A_Real_Zone' } } as unknown as User,
    });
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.INVALID_TIMEZONE),
    );
  });

  it('folds Knowledge Base search results into generation_metadata.knowledgeSourceNames, never the raw content', async () => {
    const searchKnowledge: SearchKnowledgePort = {
      execute: async () => [
        {
          content: 'Some real Cambridge excerpt about bees.',
          sourceName: 'B2 First Handbook',
          sourcePage: 12,
        },
      ],
    };
    const { calls } = await (async () => {
      const built = makeService(async () => validGeneratedSession(), { searchKnowledge });
      await built.service.execute(USER_ID, REQUESTED_AT);
      return built;
    })();

    const metadata = calls.createSession[0]?.generationMetadata;
    assert.ok(metadata);
    assert.deepEqual(metadata?.knowledgeSourceNames, [
      'B2 First Handbook p.12',
      'B2 First Handbook p.12',
    ]);
    assert.equal(JSON.stringify(metadata).includes('Some real Cambridge excerpt'), false);
  });

  it('degrades gracefully with no grounding material when searchKnowledge is not configured', async () => {
    const { calls } = await (async () => {
      const built = makeService(async () => validGeneratedSession());
      await built.service.execute(USER_ID, REQUESTED_AT);
      return built;
    })();
    assert.deepEqual(calls.createSession[0]?.generationMetadata?.knowledgeSourceNames, []);
  });
});

// ── idempotency ──────────────────────────────────────────────────────────────

describe('GenerateDailySessionService.execute — idempotency', () => {
  it('replays without calling the LLM when a session already exists for (userId, sessionDate)', async () => {
    const { service, llmCallCount } = makeService(async () => validGeneratedSession(), {
      findByUserAndSessionDate: async () => ({ id: 'existing-session-id' }) as DailySession,
    });
    const result = await service.execute(USER_ID, REQUESTED_AT);
    assert.equal(llmCallCount(), 0);
    assert.deepEqual(result, SAFE_RESULT);
  });

  const IDEMPOTENCY_CONSTRAINT_ERROR = Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'uq_daily_sessions_user_session_date',
  });

  it('replays (instead of erroring) when two concurrent requests race past the pre-check', async () => {
    let attempt = 0;
    const { service, calls } = makeService(async () => validGeneratedSession(), {
      createSession: async () => {
        attempt += 1;
        if (attempt === 1) throw IDEMPOTENCY_CONSTRAINT_ERROR;
        return { id: 'session-id' } as DailySession;
      },
      findByUserAndSessionDate: async () =>
        attempt >= 1 ? ({ id: 'session-id' } as DailySession) : null,
    });
    const result = await service.execute(USER_ID, REQUESTED_AT);
    assert.deepEqual(result, SAFE_RESULT);
    assert.equal(calls.findByUserAndSessionDate.length, 2);
  });

  it('propagates an unrelated unique-constraint violation instead of treating it as a replay', async () => {
    const unrelatedError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'some_other_constraint',
    });
    const { service } = makeService(async () => validGeneratedSession(), {
      createSession: async () => {
        throw unrelatedError;
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => err === unrelatedError,
    );
  });
});

// ── response validation ──────────────────────────────────────────────────────

describe('GenerateDailySessionService.execute — response validation', () => {
  it('rejects a response with the wrong number of comprehension items', async () => {
    const { service } = makeService(async () => ({
      ...validGeneratedSession(),
      items: [mcqItem(1)],
    }));
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects item positions that are not exactly 1..N', async () => {
    const bad = validGeneratedSession();
    bad.items[0] = { ...bad.items[0], position: 99 } as never;
    const { service } = makeService(async () => bad);
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects an answerKey referencing an option id that does not exist', async () => {
    const bad = validGeneratedSession();
    bad.items[0] = {
      ...bad.items[0],
      answerKey: { kind: 'single_choice', acceptedOptionIds: ['z'] },
    } as never;
    const { service } = makeService(async () => bad);
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects duplicate sentence target text', async () => {
    const bad = validGeneratedSession();
    bad.sentenceTargets[1] = { ...bad.sentenceTargets[0] };
    const { service } = makeService(async () => bad);
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects the wrong number of sentence targets', async () => {
    const bad = validGeneratedSession();
    bad.sentenceTargets = bad.sentenceTargets.slice(0, 1);
    const { service } = makeService(async () => bad);
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('assigns server-generated ids to sentence targets, never trusting one from the model', async () => {
    const withSpoofedId = {
      ...validGeneratedSession(),
      sentenceTargets: validGeneratedSession().sentenceTargets.map((t) => ({
        ...t,
        id: 'attacker-controlled-id',
      })),
    };
    const { calls } = await (async () => {
      const built = makeService(async () => withSpoofedId);
      await built.service.execute(USER_ID, REQUESTED_AT);
      return built;
    })();
    const ids = calls.createSession[0]?.sentenceTargets.map((t) => t.id) ?? [];
    assert.equal(ids.includes('attacker-controlled-id'), false);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ── input validation ─────────────────────────────────────────────────────────

describe('GenerateDailySessionService.execute — input validation', () => {
  it('rejects a blank userId', async () => {
    const { service } = makeService(async () => validGeneratedSession());
    await assert.rejects(
      () => service.execute('', REQUESTED_AT),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an invalid targetLevel', async () => {
    const { service } = makeService(async () => validGeneratedSession());
    await assert.rejects(
      () => service.execute(USER_ID, REQUESTED_AT, { targetLevel: 'not-a-level' as never }),
      (err) => assertGenErr(err, GenerateDailySessionErrorCode.INVALID_INPUT),
    );
  });
});
