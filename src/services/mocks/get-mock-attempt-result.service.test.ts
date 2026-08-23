import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  GetMockAttemptResultService,
  GetMockAttemptResultError,
  GetMockAttemptResultErrorCode,
} from './get-mock-attempt-result.service';
import type {
  MockAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  WritingTasksRepositoryPort,
  ListeningSourcesRepositoryPort,
} from './get-mock-attempt-result.service';
import {
  ExamType,
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeExercise } from '@models/PracticeExercise';
import type { PracticeItem } from '@models/PracticeItem';
import type { WritingTask } from '@models/WritingTask';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const NOW = new Date('2026-01-01T10:00:00Z');
const FAKE_DATA_SOURCE = {} as DataSource;

function makeAttempt(overrides: Partial<MockAttempt> = {}): MockAttempt {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    exam_type: ExamType.B2_FIRST,
    status: MockAttemptStatus.COMPLETED,
    started_at: NOW,
    submitted_at: NOW,
    result_mock_test_id: 'mocktest-1',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as MockAttempt;
}

function makeObjectiveSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-uoe1',
    mock_attempt_id: ATTEMPT_ID,
    section_code: 'uoe-part-1',
    content_type: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    practice_exercise_id: 'exercise-1',
    writing_task_id: null,
    listening_source_id: null,
    status: MockAttemptSectionStatus.COMPLETED,
    time_limit_seconds: 900,
    started_at: NOW,
    completed_at: NOW,
    answers: {
      kind: 'objective',
      answers: [
        {
          itemId: 'item-1',
          answer: { kind: 'single_choice', optionId: 'a' },
          responseTimeMs: null,
        },
      ],
    },
    raw_score: '1.00',
    max_score: '1.00',
    grading_feedback: {
      kind: 'objective',
      version: 'practice-attempt-feedback-v1',
      unansweredCount: 0,
      skillBreakdown: [],
    },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as MockAttemptSection;
}

function makeWritingSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-writing1',
    mock_attempt_id: ATTEMPT_ID,
    section_code: 'writing-part-1',
    content_type: MockAttemptSectionContentType.WRITING_TASK,
    practice_exercise_id: null,
    writing_task_id: 'task-1',
    listening_source_id: null,
    status: MockAttemptSectionStatus.COMPLETED,
    time_limit_seconds: 2400,
    started_at: NOW,
    completed_at: NOW,
    answers: { kind: 'writing', content: 'My essay.' },
    raw_score: '15.00',
    max_score: '20.00',
    grading_feedback: {
      kind: 'writing',
      version: 'writing-feedback-v1',
      criteria: [],
      overallBand: 15,
      maxBand: 20,
      corrections: [],
      rewrittenText: 'Rewritten.',
      summary: 'Solid.',
    },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as MockAttemptSection;
}

const ITEM: PracticeItem = {
  id: 'item-1',
  exercise_id: 'exercise-1',
  position: 1,
  task_type: 'multiple_choice_cloze',
  prompt: 'The weather ___ nice today.',
  options: [
    { id: 'a', label: 'is' },
    { id: 'b', label: 'be' },
  ],
  answer_key: { kind: 'single_choice', acceptedOptionIds: ['a'] },
  explanation: 'Present simple.',
  skill_tags: ['grammar'],
  metadata: null,
  created_at: NOW,
  updated_at: NOW,
} as PracticeItem;

const EXERCISE = { stimulus: 'A short passage.', target_level: null } as PracticeExercise;

const TASK = {
  id: 'task-1',
  title: 'Essay title',
  instructions: 'Write an essay.',
} as WritingTask;

function makeService(opts: {
  attempt?: MockAttempt | null;
  sections: MockAttemptSection[];
  items?: PracticeItem[];
}) {
  const mockAttempts: MockAttemptsRepositoryPort = {
    findByIdForUser: async () => (opts.attempt === undefined ? makeAttempt() : opts.attempt),
    findSectionsByAttempt: async () => opts.sections,
  };
  const practiceExercises: PracticeExercisesRepositoryPort = {
    findExerciseWithAnswerKeysForEvaluation: async () => ({
      exercise: EXERCISE,
      items: opts.items ?? [ITEM],
    }),
  };
  const writingTasks: WritingTasksRepositoryPort = {
    findByIdForUser: async () => TASK,
  };
  const listeningSources: ListeningSourcesRepositoryPort = {
    findItemsWithAnswerKeysBySourceId: async () => [],
  };
  return new GetMockAttemptResultService(FAKE_DATA_SOURCE, {
    mockAttempts: () => mockAttempts,
    practiceExercises: () => practiceExercises,
    writingTasks: () => writingTasks,
    listeningSources: () => listeningSources,
  });
}

describe('GetMockAttemptResultService.execute', () => {
  it('builds a per-item review for a completed objective section', async () => {
    const service = makeService({ sections: [makeObjectiveSection()] });

    const result = await service.execute(USER_ID, ATTEMPT_ID);

    const section = result.sections[0]!;
    assert.equal(section.review?.kind, 'objective');
    if (section.review?.kind !== 'objective') throw new Error('expected objective review');
    assert.equal(section.review.items.length, 1);
    assert.equal(section.review.items[0]?.isCorrect, true);
    assert.equal(section.review.items[0]?.correctAnswer, 'is');
    assert.equal(section.review.items[0]?.userAnswer, 'is');
  });

  it('builds a submittedText review for a completed writing section', async () => {
    const service = makeService({ sections: [makeWritingSection()] });

    const result = await service.execute(USER_ID, ATTEMPT_ID);

    const section = result.sections[0]!;
    assert.equal(section.review?.kind, 'writing');
    if (section.review?.kind !== 'writing') throw new Error('expected writing review');
    assert.equal(section.review.submittedText, 'My essay.');
    assert.equal(section.review.taskTitle, 'Essay title');
  });

  it('never builds a review for a section that is not completed', async () => {
    const service = makeService({
      sections: [
        makeObjectiveSection({ status: MockAttemptSectionStatus.IN_PROGRESS, answers: [] }),
      ],
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID);

    assert.equal(result.sections[0]?.review, null);
    assert.equal(result.sections[0]?.feedback, null);
  });

  it('rolls up completed sections into their real Cambridge paper score groups', async () => {
    const uoe = makeObjectiveSection({ raw_score: '1.00', max_score: '1.00' });
    const reading = makeObjectiveSection({
      id: 'section-reading5',
      section_code: 'reading-part-5',
      raw_score: '4.00',
      max_score: '6.00',
    });
    const writingPart1 = makeWritingSection({ raw_score: '15.00', max_score: '20.00' });
    const writingPart2 = makeWritingSection({
      id: 'section-writing2',
      section_code: 'writing-part-2',
      raw_score: '16.00',
      max_score: '20.00',
    });

    const service = makeService({ sections: [uoe, reading, writingPart1, writingPart2] });
    const result = await service.execute(USER_ID, ATTEMPT_ID);

    assert.deepEqual(result.paperScores.useOfEnglish, {
      rawScore: 1,
      maxScore: 1,
      percentage: 100,
    });
    assert.deepEqual(result.paperScores.reading, {
      rawScore: 4,
      maxScore: 6,
      percentage: Math.round((4 / 6) * 10000) / 100,
    });
    assert.deepEqual(result.paperScores.writing, { rawScore: 31, maxScore: 40, percentage: 77.5 });
    // No listening section was completed in this attempt.
    assert.deepEqual(result.paperScores.listening, { rawScore: 0, maxScore: 0, percentage: null });
  });

  it('rejects an attempt that is still in progress', async () => {
    const service = makeService({
      attempt: makeAttempt({ status: MockAttemptStatus.IN_PROGRESS }),
      sections: [],
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof GetMockAttemptResultError);
        assert.equal(err.code, GetMockAttemptResultErrorCode.ATTEMPT_NOT_FINISHED);
        return true;
      },
    );
  });

  it('allows viewing an abandoned attempt’s partial results', async () => {
    const service = makeService({
      attempt: makeAttempt({ status: MockAttemptStatus.ABANDONED }),
      sections: [makeObjectiveSection()],
    });

    const result = await service.execute(USER_ID, ATTEMPT_ID);
    assert.equal(result.attempt.status, MockAttemptStatus.ABANDONED);
  });

  it('rejects an unknown attempt', async () => {
    const service = makeService({ attempt: null, sections: [] });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID),
      (err: unknown) => {
        assert.ok(err instanceof GetMockAttemptResultError);
        assert.equal(err.code, GetMockAttemptResultErrorCode.ATTEMPT_NOT_FOUND);
        return true;
      },
    );
  });
});
