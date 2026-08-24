import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  StartMockAttemptService,
  StartMockAttemptError,
  StartMockAttemptErrorCode,
} from './start-mock-attempt.service';
import type { MockAttemptsRepositoryPort } from './start-mock-attempt.service';
import { ExamType, MockAttemptStatus } from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import { MOCK_ATTEMPT_SECTION_CATALOG } from '@lib/mocks/mock-attempt-catalog';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const STARTED_AT = new Date('2026-01-01T09:00:00Z');

function makeAttempt(overrides: Partial<MockAttempt> = {}): MockAttempt {
  return {
    id: 'attempt-1',
    user_id: USER_ID,
    exam_type: ExamType.B2_FIRST,
    status: MockAttemptStatus.IN_PROGRESS,
    started_at: STARTED_AT,
    submitted_at: null,
    result_mock_test_id: null,
    created_at: STARTED_AT,
    updated_at: STARTED_AT,
    ...overrides,
  } as MockAttempt;
}

function pgUniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: never) => Promise<T>) => work({} as never),
} as unknown as DataSource;

interface Overrides {
  findActiveByUser?: () => Promise<MockAttempt | null>;
  createAttemptWithSections?: () => Promise<MockAttempt>;
}

function makeService(overrides: Overrides = {}) {
  const calls = { createAttemptWithSections: 0, findActiveByUser: 0 };
  const repo: MockAttemptsRepositoryPort = {
    findActiveByUser: async () => {
      calls.findActiveByUser += 1;
      return overrides.findActiveByUser ? overrides.findActiveByUser() : null;
    },
    createAttemptWithSections: async () => {
      calls.createAttemptWithSections += 1;
      return overrides.createAttemptWithSections
        ? overrides.createAttemptWithSections()
        : makeAttempt();
    },
    findSectionsByAttempt: async () => [],
  };
  const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });
  return { service, calls };
}

describe('StartMockAttemptService.execute', () => {
  it('creates a new attempt with 13 pending sections when none is active', async () => {
    const captured: { sections?: unknown } = {};
    const repo: MockAttemptsRepositoryPort = {
      findActiveByUser: async () => null,
      createAttemptWithSections: async (data) => {
        captured.sections = data.sections;
        return makeAttempt();
      },
      findSectionsByAttempt: async () => [],
    };
    const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });

    const result = await service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT);

    assert.equal((captured.sections as unknown[]).length, MOCK_ATTEMPT_SECTION_CATALOG.length);
    assert.equal(result.resumed, false);
    assert.equal(result.attempt.id, 'attempt-1');
  });

  it('creates only the sections a scope covers', async () => {
    const captured: { sections?: unknown } = {};
    const repo: MockAttemptsRepositoryPort = {
      findActiveByUser: async () => null,
      createAttemptWithSections: async (data) => {
        captured.sections = data.sections;
        return makeAttempt();
      },
      findSectionsByAttempt: async () => [],
    };
    const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });

    await service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT, 'writing');

    const sections = captured.sections as { sectionCode: string }[];
    assert.deepEqual(
      sections.map((section) => section.sectionCode),
      ['writing-part-1', 'writing-part-2'],
    );
  });

  it('defaults to the whole exam when no scope is given', async () => {
    const captured: { sections?: unknown } = {};
    const repo: MockAttemptsRepositoryPort = {
      findActiveByUser: async () => null,
      createAttemptWithSections: async (data) => {
        captured.sections = data.sections;
        return makeAttempt();
      },
      findSectionsByAttempt: async () => [],
    };
    const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });

    await service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT);

    assert.equal((captured.sections as unknown[]).length, MOCK_ATTEMPT_SECTION_CATALOG.length);
  });

  it('rejects an unknown scope rather than silently widening it to the full exam', async () => {
    const { service } = makeService({ findActiveByUser: async () => null });

    // Asking for one paper and quietly getting all 13 sections would be a
    // nasty surprise, so this is an error, not a fallback.
    await assert.rejects(() =>
      service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT, 'speaking' as never),
    );
  });

  it('resumes the existing active attempt instead of creating a new one', async () => {
    const { service, calls } = makeService({
      findActiveByUser: async () => makeAttempt({ id: 'existing-attempt' }),
    });

    const result = await service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT);

    assert.equal(result.resumed, true);
    assert.equal(result.attempt.id, 'existing-attempt');
    assert.equal(calls.createAttemptWithSections, 0);
  });

  it('rejects a non-B2_FIRST examType (no generation/catalog support yet)', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(USER_ID, ExamType.IELTS, STARTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof StartMockAttemptError);
        assert.equal(err.code, StartMockAttemptErrorCode.INVALID_INPUT);
        return true;
      },
    );
  });

  it('rejects a missing userId', async () => {
    const { service } = makeService();
    await assert.rejects(() => service.execute('', ExamType.B2_FIRST, STARTED_AT));
  });

  it('recovers via retry when two concurrent starts race past the pre-check', async () => {
    let findCalls = 0;
    const repo: MockAttemptsRepositoryPort = {
      findActiveByUser: async () => {
        findCalls += 1;
        return findCalls === 1 ? null : makeAttempt({ id: 'winner-attempt' });
      },
      createAttemptWithSections: async () => {
        throw pgUniqueViolation('uq_mock_attempts_one_active_per_user');
      },
      findSectionsByAttempt: async () => [],
    };
    const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });

    const result = await service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT);

    assert.equal(result.resumed, true);
    assert.equal(result.attempt.id, 'winner-attempt');
  });

  it('gives up after exhausting retries against an unresolved race', async () => {
    const repo: MockAttemptsRepositoryPort = {
      findActiveByUser: async () => null,
      createAttemptWithSections: async () => {
        throw pgUniqueViolation('uq_mock_attempts_one_active_per_user');
      },
      findSectionsByAttempt: async () => [],
    };
    const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });

    await assert.rejects(
      () => service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof StartMockAttemptError);
        assert.equal(err.code, StartMockAttemptErrorCode.RACE_UNRESOLVED);
        return true;
      },
    );
  });

  it('does not treat an unrelated 23505 as a race — propagates it', async () => {
    const repo: MockAttemptsRepositoryPort = {
      findActiveByUser: async () => null,
      createAttemptWithSections: async () => {
        throw pgUniqueViolation('some_other_constraint');
      },
      findSectionsByAttempt: async () => [],
    };
    const service = new StartMockAttemptService(FAKE_DATA_SOURCE, { mockAttempts: () => repo });

    await assert.rejects(() => service.execute(USER_ID, ExamType.B2_FIRST, STARTED_AT));
  });
});
