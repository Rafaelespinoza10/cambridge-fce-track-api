import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  SubmitMockAttemptService,
  SubmitMockAttemptError,
  SubmitMockAttemptErrorCode,
} from './submit-mock-attempt.service';
import type { MockAttemptsRepositoryPort, MocksRepositoryPort } from './submit-mock-attempt.service';
import {
  ExamType,
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
  MockType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const SUBMITTED_AT = new Date('2026-01-01T12:00:00Z');
const FAKE_DATA_SOURCE = {} as DataSource;

function makeAttempt(overrides: Partial<MockAttempt> = {}): MockAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    exam_type: ExamType.B2_FIRST,
    status: MockAttemptStatus.IN_PROGRESS,
    started_at: SUBMITTED_AT,
    submitted_at: null,
    result_mock_test_id: null,
    created_at: SUBMITTED_AT,
    updated_at: SUBMITTED_AT,
    ...overrides,
  } as MockAttempt;
}

function makeSection(
  sectionCode: string,
  status: MockAttemptSectionStatus,
  rawScore: string | null,
  maxScore: string | null,
): MockAttemptSection {
  return {
    id: `section-${sectionCode}`,
    mock_attempt_id: ATTEMPT_ID,
    section_code: sectionCode,
    content_type: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    practice_exercise_id: 'exercise-1',
    writing_task_id: null,
    listening_source_id: null,
    status,
    time_limit_seconds: 900,
    started_at: SUBMITTED_AT,
    completed_at: status === MockAttemptSectionStatus.COMPLETED ? SUBMITTED_AT : null,
    answers: [],
    raw_score: rawScore,
    max_score: maxScore,
    grading_feedback: null,
    created_at: SUBMITTED_AT,
    updated_at: SUBMITTED_AT,
  } as MockAttemptSection;
}

function makeCompletedSections(): MockAttemptSection[] {
  return [
    makeSection('uoe-part-1', MockAttemptSectionStatus.COMPLETED, '6', '8'),
    makeSection('reading-part-5', MockAttemptSectionStatus.COMPLETED, '4', '6'),
    makeSection('writing-part-1', MockAttemptSectionStatus.COMPLETED, '15', '20'),
    makeSection('listening-part-1', MockAttemptSectionStatus.COMPLETED, '7', '8'),
  ];
}

interface Harness {
  service: SubmitMockAttemptService;
  createMockCalls: unknown[];
  createSectionsCalls: unknown[];
  completeAttemptCalls: unknown[];
}

function makeService(opts: {
  attempt: MockAttempt | null;
  sections: MockAttemptSection[];
}): Harness {
  const createMockCalls: unknown[] = [];
  const createSectionsCalls: unknown[] = [];
  const completeAttemptCalls: unknown[] = [];

  const mockAttempts: MockAttemptsRepositoryPort = {
    findByIdForUser: async () => opts.attempt,
    findSectionsByAttempt: async () => opts.sections,
    completeAttempt: async (attemptId, data) => {
      completeAttemptCalls.push({ attemptId, data });
    },
  };
  const mocks: MocksRepositoryPort = {
    createMock: async (data) => {
      createMockCalls.push(data);
      return { id: 'mock-test-1' } as never;
    },
    createSections: async (data) => {
      createSectionsCalls.push(data);
      return [] as never;
    },
    resolveExamSectionIds: async () => new Map(),
  };

  const service = new SubmitMockAttemptService(FAKE_DATA_SOURCE, {
    mockAttempts: () => mockAttempts,
    mocks: () => mocks,
  });
  return { service, createMockCalls, createSectionsCalls, completeAttemptCalls };
}

describe('SubmitMockAttemptService.execute', () => {
  it('aggregates completed sections into a MockTest + MockSectionScore rows and completes the attempt', async () => {
    const { service, createMockCalls, createSectionsCalls, completeAttemptCalls } = makeService({
      attempt: makeAttempt(),
      sections: makeCompletedSections(),
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID, SUBMITTED_AT);

    assert.equal(result.mockTestId, 'mock-test-1');
    assert.equal(createMockCalls.length, 1);
    const mockData = createMockCalls[0] as { mockType: MockType; estimatedStandardizedScore: unknown };
    assert.equal(mockData.mockType, MockType.FULL);
    // Never invents a Cambridge Scale Score — stays null, same as manual registration.
    assert.equal(mockData.estimatedStandardizedScore, null);

    assert.equal(createSectionsCalls.length, 1);
    const sections = createSectionsCalls[0] as { sectionCode: string; rawScore: number; maxScore: number; percentage: number }[];
    assert.equal(sections.length, 4);
    const uoe = sections.find((s) => s.sectionCode === 'uoe-part-1');
    assert.equal(uoe?.rawScore, 6);
    assert.equal(uoe?.maxScore, 8);
    assert.equal(uoe?.percentage, 75);

    assert.equal(completeAttemptCalls.length, 1);
    const completeData = completeAttemptCalls[0] as { data: { resultMockTestId: string } };
    assert.equal(completeData.data.resultMockTestId, 'mock-test-1');
  });

  it('rejects when at least one section is not completed', async () => {
    const sections = makeCompletedSections();
    sections[1] = makeSection('reading-part-5', MockAttemptSectionStatus.IN_PROGRESS, null, null);
    const { service, createMockCalls } = makeService({ attempt: makeAttempt(), sections });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, SUBMITTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof SubmitMockAttemptError);
        assert.equal(err.code, SubmitMockAttemptErrorCode.SECTIONS_NOT_COMPLETE);
        assert.deepEqual(err.incompleteSectionCodes, ['reading-part-5']);
        return true;
      },
    );
    assert.equal(createMockCalls.length, 0);
  });

  it('replays idempotently when the attempt is already completed', async () => {
    const { service, createMockCalls } = makeService({
      attempt: makeAttempt({
        status: MockAttemptStatus.COMPLETED,
        submitted_at: SUBMITTED_AT,
        result_mock_test_id: 'already-mock-test',
      }),
      sections: makeCompletedSections(),
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID, SUBMITTED_AT);

    assert.equal(result.mockTestId, 'already-mock-test');
    assert.equal(createMockCalls.length, 0);
  });

  it('rejects an abandoned attempt', async () => {
    const { service } = makeService({
      attempt: makeAttempt({ status: MockAttemptStatus.ABANDONED }),
      sections: makeCompletedSections(),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, SUBMITTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof SubmitMockAttemptError);
        assert.equal(err.code, SubmitMockAttemptErrorCode.ATTEMPT_ABANDONED);
        return true;
      },
    );
  });

  it('rejects an unknown attempt', async () => {
    const { service } = makeService({ attempt: null, sections: [] });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, SUBMITTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof SubmitMockAttemptError);
        assert.equal(err.code, SubmitMockAttemptErrorCode.ATTEMPT_NOT_FOUND);
        return true;
      },
    );
  });
});
