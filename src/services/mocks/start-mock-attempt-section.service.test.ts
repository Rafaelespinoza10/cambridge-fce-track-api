import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  StartMockAttemptSectionService,
  StartMockAttemptSectionError,
  StartMockAttemptSectionErrorCode,
} from './start-mock-attempt-section.service';
import type {
  MockAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  WritingTasksRepositoryPort,
  ListeningSourcesRepositoryPort,
  GeneratePracticeExercisePort,
  GenerateWritingTaskPort,
} from './start-mock-attempt-section.service';
import {
  ExamType,
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
  WritingTaskType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const NOW = new Date('2026-01-01T09:00:00Z');
const FAKE_DATA_SOURCE = {} as DataSource;

function makeAttempt(overrides: Partial<MockAttempt> = {}): MockAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    exam_type: ExamType.B2_FIRST,
    status: MockAttemptStatus.IN_PROGRESS,
    started_at: NOW,
    submitted_at: null,
    result_mock_test_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as MockAttempt;
}

function makeSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-1',
    mock_attempt_id: ATTEMPT_ID,
    section_code: 'uoe-part-1',
    content_type: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    practice_exercise_id: null,
    writing_task_id: null,
    listening_source_id: null,
    status: MockAttemptSectionStatus.PENDING,
    time_limit_seconds: 900,
    started_at: null,
    completed_at: null,
    answers: [],
    raw_score: null,
    max_score: null,
    grading_feedback: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as MockAttemptSection;
}

function makeHarness(opts: {
  section: MockAttemptSection | null;
  attempt?: MockAttempt | null;
  listeningPick?: unknown;
}) {
  let currentSection = opts.section;
  const startCalls: unknown[] = [];
  const generateExerciseCalls: unknown[] = [];
  const generateTaskCalls: unknown[] = [];

  const mockAttempts: MockAttemptsRepositoryPort = {
    findByIdForUser: async () => (opts.attempt === undefined ? makeAttempt() : opts.attempt),
    findSectionByCodeForUser: async () => currentSection,
    startSectionContent: async (sectionId, data) => {
      startCalls.push({ sectionId, data });
      if (currentSection !== null) {
        currentSection = {
          ...currentSection,
          practice_exercise_id: data.practiceExerciseId ?? null,
          writing_task_id: data.writingTaskId ?? null,
          listening_source_id: data.listeningSourceId ?? null,
          status: MockAttemptSectionStatus.IN_PROGRESS,
          started_at: data.startedAt,
        } as MockAttemptSection;
      }
    },
  };
  const generatePracticeExercise: GeneratePracticeExercisePort = {
    execute: async (userId, request) => {
      generateExerciseCalls.push({ userId, request });
      return {
        exercise: { id: 'exercise-1' },
        items: [],
      } as never;
    },
  };
  const generateWritingTask: GenerateWritingTaskPort = {
    execute: async (userId, request) => {
      generateTaskCalls.push({ userId, request });
      return { id: 'task-1', taskType: request.taskType } as never;
    },
  };
  const practiceExercises: PracticeExercisesRepositoryPort = {
    findSafeExerciseWithItemsForUser: async () =>
      ({ exercise: { id: 'exercise-1' }, items: [] }) as never,
  };
  const writingTasks: WritingTasksRepositoryPort = {
    findSafeTaskForUser: async () => ({ id: 'task-1' }) as never,
  };
  const listeningSources: ListeningSourcesRepositoryPort = {
    findRandomActiveSourceWithItemsForPart: async () => (opts.listeningPick ?? null) as never,
    findByIdWithItems: async () => (opts.listeningPick ?? null) as never,
  };

  const service = new StartMockAttemptSectionService(FAKE_DATA_SOURCE, {
    generatePracticeExercise,
    generateWritingTask,
    mockAttempts: () => mockAttempts,
    practiceExercises: () => practiceExercises,
    writingTasks: () => writingTasks,
    listeningSources: () => listeningSources,
    now: () => NOW,
    random: () => 0.99, // picks the last item in a pool deterministically
  });

  return { service, startCalls, generateExerciseCalls, generateTaskCalls };
}

describe('StartMockAttemptSectionService.execute', () => {
  it('generates a Use of English exercise for a pending practice_exercise section', async () => {
    const { service, generateExerciseCalls, startCalls } = makeHarness({
      section: makeSection({ section_code: 'uoe-part-1' }),
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1');

    assert.equal(result.content.contentType, 'practice_exercise');
    assert.equal(generateExerciseCalls.length, 1);
    const call = generateExerciseCalls[0] as {
      request: { partCode: string; idempotencyKey: string };
    };
    assert.equal(call.request.partCode, 'UOE_PART_1');
    assert.equal(call.request.idempotencyKey, `${ATTEMPT_ID}:uoe-part-1`);
    assert.equal(startCalls.length, 1);
  });

  it('generates a Reading exercise for a pending Reading section', async () => {
    const { service, generateExerciseCalls } = makeHarness({
      section: makeSection({ section_code: 'reading-part-6' }),
    });

    await service.execute(USER_ID, ATTEMPT_ID, 'reading-part-6');

    const call = generateExerciseCalls[0] as { request: { partCode: string; taskType: string } };
    assert.equal(call.request.partCode, 'READING_PART_6');
    assert.equal(call.request.taskType, 'gapped_text');
  });

  it('picks a WritingTaskType from the pool for a writing section', async () => {
    const { service, generateTaskCalls } = makeHarness({
      section: makeSection({
        section_code: 'writing-part-2',
        content_type: MockAttemptSectionContentType.WRITING_TASK,
      }),
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'writing-part-2');

    assert.equal(result.content.contentType, 'writing_task');
    assert.equal(generateTaskCalls.length, 1);
    const call = generateTaskCalls[0] as { request: { taskType: WritingTaskType } };
    // random() => 0.99 picks the last entry in [ARTICLE, EMAIL, REPORT, REVIEW]
    assert.equal(call.request.taskType, WritingTaskType.REVIEW);
  });

  it('always uses ESSAY for writing-part-1 (single-entry pool)', async () => {
    const { service, generateTaskCalls } = makeHarness({
      section: makeSection({
        section_code: 'writing-part-1',
        content_type: MockAttemptSectionContentType.WRITING_TASK,
      }),
    });

    await service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1');

    const call = generateTaskCalls[0] as { request: { taskType: WritingTaskType } };
    assert.equal(call.request.taskType, WritingTaskType.ESSAY);
  });

  it('picks a curated Listening source for a pending listening section', async () => {
    const { service, startCalls } = makeHarness({
      section: makeSection({
        section_code: 'listening-part-1',
        content_type: MockAttemptSectionContentType.LISTENING,
      }),
      listeningPick: {
        source: {
          id: 'listening-source-1',
          title: 't',
          instructions: 'i',
          videoProvider: 'youtube',
          videoExternalId: 'abc123',
          videoStartSeconds: 0,
          videoEndSeconds: 100,
        },
        items: [],
      },
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'listening-part-1');

    assert.equal(result.content.contentType, 'listening');
    const startData = (startCalls[0] as { data: { listeningSourceId: string } }).data;
    assert.equal(startData.listeningSourceId, 'listening-source-1');
  });

  it('surfaces a clear error when no Listening source is curated yet for a part', async () => {
    const { service } = makeHarness({
      section: makeSection({
        section_code: 'listening-part-1',
        content_type: MockAttemptSectionContentType.LISTENING,
      }),
      listeningPick: null,
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'listening-part-1'),
      (err: unknown) => {
        assert.ok(err instanceof StartMockAttemptSectionError);
        assert.equal(err.code, StartMockAttemptSectionErrorCode.LISTENING_NOT_CURATED);
        return true;
      },
    );
  });

  it('does not regenerate content for a section already past pending (idempotent re-entry)', async () => {
    const { service, generateExerciseCalls } = makeHarness({
      section: makeSection({
        status: MockAttemptSectionStatus.IN_PROGRESS,
        practice_exercise_id: 'exercise-1',
        started_at: NOW,
      }),
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1');

    assert.equal(generateExerciseCalls.length, 0);
    assert.equal(result.content.contentType, 'practice_exercise');
  });

  it('rejects when the attempt is not in progress', async () => {
    const { service } = makeHarness({
      section: makeSection(),
      attempt: makeAttempt({ status: MockAttemptStatus.COMPLETED }),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1'),
      (err: unknown) => {
        assert.ok(err instanceof StartMockAttemptSectionError);
        assert.equal(err.code, StartMockAttemptSectionErrorCode.ATTEMPT_NOT_ACTIVE);
        return true;
      },
    );
  });
});
