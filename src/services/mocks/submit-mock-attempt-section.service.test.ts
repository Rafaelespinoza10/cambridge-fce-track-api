import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  SubmitMockAttemptSectionService,
  SubmitMockAttemptSectionError,
  SubmitMockAttemptSectionErrorCode,
} from './submit-mock-attempt-section.service';
import type {
  MockAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  ListeningSourcesRepositoryPort,
  WritingTasksRepositoryPort,
} from './submit-mock-attempt-section.service';
import {
  ExamType,
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
  WritingTaskType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeItem } from '@models/PracticeItem';
import type { WritingTask } from '@models/WritingTask';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const SUBMITTED_AT = new Date('2026-01-01T10:00:00Z');
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

function makeSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-1',
    mock_attempt_id: ATTEMPT_ID,
    section_code: 'uoe-part-1',
    content_type: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    practice_exercise_id: 'exercise-1',
    writing_task_id: null,
    listening_source_id: null,
    status: MockAttemptSectionStatus.IN_PROGRESS,
    time_limit_seconds: 900,
    started_at: SUBMITTED_AT,
    completed_at: null,
    answers: [],
    raw_score: null,
    max_score: null,
    grading_feedback: null,
    created_at: SUBMITTED_AT,
    updated_at: SUBMITTED_AT,
    ...overrides,
  } as MockAttemptSection;
}

function makeItem(id: string, correctOptionId: string): PracticeItem {
  return {
    id,
    exercise_id: 'exercise-1',
    position: Number(id.split('-')[1]),
    task_type: 'multiple_choice_cloze',
    prompt: 'p',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    answer_key: { kind: 'single_choice', acceptedOptionIds: [correctOptionId] },
    explanation: null,
    skill_tags: ['tag1'],
    metadata: null,
    created_at: SUBMITTED_AT,
    updated_at: SUBMITTED_AT,
  } as PracticeItem;
}

interface Harness {
  service: SubmitMockAttemptSectionService;
  completeCalls: { sectionId: string; data: unknown }[];
  llmCalls: number;
}

function makeService(opts: {
  section: MockAttemptSection | null;
  attempt?: MockAttempt | null;
  items?: PracticeItem[];
  listeningItems?: { id: string; answer_key: unknown; skill_tags: string[] }[];
  task?: WritingTask | null;
  llmResponse?: unknown;
  llmError?: Error;
}): Harness {
  const completeCalls: { sectionId: string; data: unknown }[] = [];
  let llmCalls = 0;
  let currentSection = opts.section;

  const mockAttempts: MockAttemptsRepositoryPort = {
    findByIdForUser: async () => (opts.attempt === undefined ? makeAttempt() : opts.attempt),
    findSectionByCodeForUser: async () => currentSection,
    completeSection: async (sectionId, data) => {
      completeCalls.push({ sectionId, data });
      const d = data as {
        answers: unknown;
        rawScore: number;
        maxScore: number;
        gradingFeedback: unknown;
        completedAt: Date;
      };
      if (currentSection !== null) {
        currentSection = {
          ...currentSection,
          answers: d.answers,
          raw_score: String(d.rawScore),
          max_score: String(d.maxScore),
          grading_feedback: d.gradingFeedback,
          status: MockAttemptSectionStatus.COMPLETED,
          completed_at: d.completedAt,
        } as MockAttemptSection;
      }
    },
  };
  const practiceExercises: PracticeExercisesRepositoryPort = {
    findExerciseWithAnswerKeysForEvaluation: async () =>
      opts.items ? { items: opts.items } : null,
  };
  const writingTasks: WritingTasksRepositoryPort = {
    findByIdForUser: async () => opts.task ?? null,
  };
  const listeningSources: ListeningSourcesRepositoryPort = {
    findItemsWithAnswerKeysBySourceId: async () => (opts.listeningItems ?? []) as never,
  };

  const service = new SubmitMockAttemptSectionService(FAKE_DATA_SOURCE, {
    llm: {
      completeStructured: async () => {
        llmCalls += 1;
        if (opts.llmError) throw opts.llmError;
        return opts.llmResponse;
      },
    },
    mockAttempts: () => mockAttempts,
    practiceExercises: () => practiceExercises,
    writingTasks: () => writingTasks,
    listeningSources: () => listeningSources,
    now: () => SUBMITTED_AT,
  });

  return {
    service,
    completeCalls,
    get llmCalls() {
      return llmCalls;
    },
  } as Harness;
}

describe('SubmitMockAttemptSectionService.execute — objective sections', () => {
  it('grades a practice_exercise section: correct/incorrect/unanswered', async () => {
    const items = [makeItem('item-1', 'a'), makeItem('item-2', 'a'), makeItem('item-3', 'a')];
    const { service, completeCalls } = makeService({ section: makeSection(), items });

    const result = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      'uoe-part-1',
      {
        answers: [
          { itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'a' } }, // correct
          { itemId: 'item-2', answer: { kind: 'single_choice', optionId: 'b' } }, // wrong
          // item-3 left unanswered
        ],
      },
      SUBMITTED_AT,
    );

    assert.equal(result.section.status, MockAttemptSectionStatus.COMPLETED);
    assert.equal(result.percentage, Math.round((1 / 3) * 10000) / 100);
    assert.equal(completeCalls.length, 1);
    const data = completeCalls[0]?.data as { rawScore: number; maxScore: number };
    assert.equal(data.rawScore, 1);
    assert.equal(data.maxScore, 3);
  });

  it('grades a listening section the same way as a practice_exercise section', async () => {
    const section = makeSection({
      section_code: 'listening-part-1',
      content_type: MockAttemptSectionContentType.LISTENING,
      practice_exercise_id: null,
      listening_source_id: 'listening-source-1',
    });
    const { service } = makeService({
      section,
      listeningItems: [
        {
          id: 'litem-1',
          answer_key: { kind: 'single_choice', acceptedOptionIds: ['a'] },
          skill_tags: [],
        },
      ],
    });

    const result = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      'listening-part-1',
      { answers: [{ itemId: 'litem-1', answer: { kind: 'single_choice', optionId: 'a' } }] },
      SUBMITTED_AT,
    );

    assert.equal(result.percentage, 100);
  });

  it('replays idempotently when the section is already completed', async () => {
    const completedSection = makeSection({
      status: MockAttemptSectionStatus.COMPLETED,
      raw_score: '2.00',
      max_score: '4.00',
      grading_feedback: {
        kind: 'objective',
        version: 'practice-attempt-feedback-v1',
        unansweredCount: 0,
        skillBreakdown: [],
      },
      completed_at: SUBMITTED_AT,
    });
    const { service, completeCalls } = makeService({ section: completedSection });

    const result = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      'uoe-part-1',
      { answers: [] },
      SUBMITTED_AT,
    );

    assert.equal(result.percentage, 50);
    assert.equal(completeCalls.length, 0);
  });

  it('rejects submitting a section that was never started (still pending)', async () => {
    const { service } = makeService({
      section: makeSection({ status: MockAttemptSectionStatus.PENDING }),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }, SUBMITTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof SubmitMockAttemptSectionError);
        assert.equal(err.code, SubmitMockAttemptSectionErrorCode.SECTION_NOT_STARTED);
        return true;
      },
    );
  });

  it('rejects an unknown attempt', async () => {
    const { service } = makeService({ section: makeSection(), attempt: null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }, SUBMITTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof SubmitMockAttemptSectionError);
        assert.equal(err.code, SubmitMockAttemptSectionErrorCode.ATTEMPT_NOT_FOUND);
        return true;
      },
    );
  });

  it('rejects an unknown section', async () => {
    const { service } = makeService({ section: null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }, SUBMITTED_AT),
      (err: unknown) => {
        assert.ok(err instanceof SubmitMockAttemptSectionError);
        assert.equal(err.code, SubmitMockAttemptSectionErrorCode.SECTION_NOT_FOUND);
        return true;
      },
    );
  });
});

describe('SubmitMockAttemptSectionService.execute — writing section', () => {
  const task = {
    id: 'task-1',
    user_id: USER_ID,
    task_type: WritingTaskType.ESSAY,
    target_level: null,
    title: 'Essay title',
    instructions: 'Write an essay.',
    min_words: 140,
    max_words: 190,
    time_limit_seconds: 2400,
  } as WritingTask;

  function validGradingResponse() {
    return {
      criteria: [
        {
          criterion: 'content',
          band: 4,
          justification: 'Good content, addresses the topic well.',
          evidenceQuotes: [],
        },
        {
          criterion: 'communicative_achievement',
          band: 4,
          justification: 'Clear and appropriate.',
          evidenceQuotes: [],
        },
        {
          criterion: 'organization',
          band: 4,
          justification: 'Well organized text.',
          evidenceQuotes: [],
        },
        {
          criterion: 'language',
          band: 3,
          justification: 'Mostly accurate language use.',
          evidenceQuotes: [],
        },
      ],
      corrections: [],
      rewrittenText: 'A rewritten version of the essay.',
      summary: 'Solid attempt overall.',
    };
  }

  it('grades a writing section via the LLM and stores overallBand/maxBand as raw/max score', async () => {
    const section = makeSection({
      section_code: 'writing-part-1',
      content_type: MockAttemptSectionContentType.WRITING_TASK,
      practice_exercise_id: null,
      writing_task_id: 'task-1',
    });
    const { service, completeCalls } = makeService({
      section,
      task,
      llmResponse: validGradingResponse(),
    });

    const result = await service.execute(
      USER_ID,
      ATTEMPT_ID,
      'writing-part-1',
      { content: 'My essay text, long enough to be graded.' },
      SUBMITTED_AT,
    );

    assert.equal(result.percentage, (15 / 20) * 100);
    const data = completeCalls[0]?.data as { rawScore: number; maxScore: number };
    assert.equal(data.rawScore, 15);
    assert.equal(data.maxScore, 20);
  });

  it('maps an LLM failure to an AI error code without persisting anything', async () => {
    const section = makeSection({
      section_code: 'writing-part-1',
      content_type: MockAttemptSectionContentType.WRITING_TASK,
      practice_exercise_id: null,
      writing_task_id: 'task-1',
    });
    const { service, completeCalls } = makeService({
      section,
      task,
      llmError: Object.assign(new Error('rate limited'), { code: 'RATE_LIMITED' }),
    });

    await assert.rejects(() =>
      service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', { content: 'text' }, SUBMITTED_AT),
    );
    assert.equal(completeCalls.length, 0);
  });
});
