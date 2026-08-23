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
import { deterministicUuidFrom } from '@lib/shared/deterministic-uuid';

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
  otherSections?: MockAttemptSection[];
  listeningPickForPartAndVideo?: unknown;
}) {
  let currentSection = opts.section;
  const startCalls: unknown[] = [];
  const generateExerciseCalls: unknown[] = [];
  const generateTaskCalls: unknown[] = [];

  const mockAttempts: MockAttemptsRepositoryPort = {
    findByIdForUser: async () => (opts.attempt === undefined ? makeAttempt() : opts.attempt),
    findSectionByCodeForUser: async () => currentSection,
    findSectionsByAttempt: async () => opts.otherSections ?? (currentSection ? [currentSection] : []),
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
          ...(data.timeLimitSecondsOverride !== undefined
            ? { time_limit_seconds: data.timeLimitSecondsOverride }
            : {}),
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
    findActiveSourceWithItemsForPartAndVideo: async () =>
      (opts.listeningPickForPartAndVideo ?? null) as never,
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
    // Must be a valid uuid (practice_exercises.idempotency_key's column type)
    // and deterministic — the exact hash of attemptId+sectionCode, so a
    // retry replays instead of erroring on `invalid input syntax for type uuid`.
    assert.equal(call.request.idempotencyKey, deterministicUuidFrom(`${ATTEMPT_ID}:uoe-part-1`));
    assert.match(
      call.request.idempotencyKey,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
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

  it('reuses the same curated video across all 4 Listening parts of one attempt', async () => {
    const existingListeningSection = makeSection({
      section_code: 'listening-part-1',
      content_type: MockAttemptSectionContentType.LISTENING,
      status: MockAttemptSectionStatus.IN_PROGRESS,
      listening_source_id: 'listening-source-1',
      started_at: NOW,
    });
    const pendingSection = makeSection({
      section_code: 'listening-part-2',
      content_type: MockAttemptSectionContentType.LISTENING,
    });

    const { service, startCalls } = makeHarness({
      section: pendingSection,
      otherSections: [existingListeningSection, pendingSection],
      listeningPick: {
        source: {
          id: 'listening-source-1',
          title: 't1',
          instructions: 'i1',
          videoProvider: 'youtube',
          videoExternalId: 'vid-abc',
          videoStartSeconds: 0,
          videoEndSeconds: 690,
        },
        items: [],
      },
      listeningPickForPartAndVideo: {
        source: {
          id: 'listening-source-2-matched',
          title: 't2',
          instructions: 'i2',
          videoProvider: 'youtube',
          videoExternalId: 'vid-abc',
          videoStartSeconds: 700,
          videoEndSeconds: 1400,
        },
        items: [],
      },
    });

    await service.execute(USER_ID, ATTEMPT_ID, 'listening-part-2');

    const startData = (startCalls[0] as { data: { listeningSourceId: string } }).data;
    assert.equal(startData.listeningSourceId, 'listening-source-2-matched');
  });

  it('falls back to a random pick if no source shares the already-picked video for this part', async () => {
    const existingListeningSection = makeSection({
      section_code: 'listening-part-1',
      content_type: MockAttemptSectionContentType.LISTENING,
      status: MockAttemptSectionStatus.IN_PROGRESS,
      listening_source_id: 'listening-source-1',
      started_at: NOW,
    });
    const pendingSection = makeSection({
      section_code: 'listening-part-2',
      content_type: MockAttemptSectionContentType.LISTENING,
    });

    const { service, startCalls } = makeHarness({
      section: pendingSection,
      otherSections: [existingListeningSection, pendingSection],
      listeningPick: {
        source: {
          id: 'listening-source-1',
          title: 't1',
          instructions: 'i1',
          videoProvider: 'youtube',
          videoExternalId: 'vid-abc',
          videoStartSeconds: 0,
          videoEndSeconds: 690,
        },
        items: [],
      },
      listeningPickForPartAndVideo: null,
    });

    await service.execute(USER_ID, ATTEMPT_ID, 'listening-part-2');

    const startData = (startCalls[0] as { data: { listeningSourceId: string } }).data;
    // Falls back to opts.listeningPick, which findRandomActiveSourceWithItemsForPart returns.
    assert.equal(startData.listeningSourceId, 'listening-source-1');
  });

  it('pools unused time from a completed UoE part into the next UoE part', async () => {
    const completedPart1 = makeSection({
      section_code: 'uoe-part-1',
      status: MockAttemptSectionStatus.COMPLETED,
      time_limit_seconds: 900,
      started_at: new Date('2026-01-01T09:00:00Z'),
      completed_at: new Date('2026-01-01T09:10:00Z'),
    });
    const pendingPart2 = makeSection({ section_code: 'uoe-part-2', time_limit_seconds: 900 });

    const { service, startCalls } = makeHarness({
      section: pendingPart2,
      otherSections: [completedPart1, pendingPart2],
    });

    await service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-2');

    const startData = (startCalls[0] as { data: { timeLimitSecondsOverride?: number } }).data;
    // uoe-part-2 base is 900s (15 min) + 300s leftover from part 1 (used 10 of 15 min).
    assert.equal(startData.timeLimitSecondsOverride, 1200);
  });

  it('does not pool time from Reading sections into Use of English', async () => {
    const completedReading = makeSection({
      section_code: 'reading-part-5',
      status: MockAttemptSectionStatus.COMPLETED,
      time_limit_seconds: 720,
      started_at: new Date('2026-01-01T09:00:00Z'),
      completed_at: new Date('2026-01-01T09:01:00Z'),
    });
    const pendingUoe = makeSection({ section_code: 'uoe-part-1', time_limit_seconds: 900 });

    const { service, startCalls } = makeHarness({
      section: pendingUoe,
      otherSections: [completedReading, pendingUoe],
    });

    await service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1');

    const startData = (startCalls[0] as { data: { timeLimitSecondsOverride?: number } }).data;
    assert.equal(startData.timeLimitSecondsOverride, 900);
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
