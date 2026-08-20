import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager } from 'typeorm';

import {
  SubmitWritingSubmissionService,
  SubmitWritingSubmissionError,
  SubmitWritingSubmissionErrorCode,
} from './submit-writing-submission.service';
import type {
  LLMServicePort,
  WritingTasksRepositoryPort,
  WritingSubmissionsRepositoryPort,
} from './submit-writing-submission.service';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import { WritingSubmissionStatus, EnglishLevel, WritingTaskType } from '../../models/enums';
import type { WritingTask } from '../../models/WritingTask';
import type { WritingSubmission } from '../../models/WritingSubmission';
import type { GradeSubmissionData } from '../../repositories/writing-submissions.repository';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SUBMISSION_ID = 'bbbbbbbb-1111-1111-1111-111111111111';
const TASK_ID = 'cccccccc-1111-1111-1111-111111111111';

const SUBMITTED_TEXT =
  'Technology is very important in education. I am agree with this opinion because ' +
  'students learn faster with computers. In my opinion, schools should use more tablets ' +
  'and laptops in classrooms every day.';

function makeTask(overrides: Partial<WritingTask> = {}): WritingTask {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    task_type: WritingTaskType.ESSAY,
    title: 'Technology in education',
    instructions: 'Write an essay about technology in education.',
    target_level: EnglishLevel.B2,
    min_words: 140,
    max_words: 190,
    time_limit_seconds: 2400,
    ...overrides,
  } as WritingTask;
}

function makeSubmission(overrides: Partial<WritingSubmission> = {}): WritingSubmission {
  return {
    id: SUBMISSION_ID,
    user_id: USER_ID,
    task_id: TASK_ID,
    status: WritingSubmissionStatus.IN_PROGRESS,
    started_at: new Date('2026-01-01T10:00:00.000Z'),
    submitted_at: null,
    duration_seconds: null,
    submitted_text: null,
    word_count: null,
    feedback: null,
    plan_day_id: null,
    ...overrides,
  } as WritingSubmission;
}

/** Grading response with exactly the 4 required criteria, all quotes/excerpts real substrings of SUBMITTED_TEXT. */
function validGradingResponse() {
  return {
    criteria: [
      {
        criterion: 'content',
        band: 4,
        justification: 'Covers the required content points.',
        evidenceQuotes: ['Technology is very important in education'],
      },
      {
        criterion: 'communicative_achievement',
        band: 3,
        justification: 'Appropriate essay register throughout.',
        evidenceQuotes: ['In my opinion, schools should use more tablets'],
      },
      {
        criterion: 'organization',
        band: 4,
        justification: 'Clear paragraphing.',
        evidenceQuotes: [],
      },
      {
        criterion: 'language',
        band: 2,
        justification: 'A recurring grammar error affects accuracy.',
        evidenceQuotes: ['I am agree with this opinion'],
      },
    ],
    corrections: [
      {
        originalExcerpt: 'I am agree with this opinion',
        correctedExcerpt: 'I agree with this opinion',
        explanation: '"Agree" is a verb, never preceded by "am/is/are".',
        category: 'grammar',
      },
    ],
    rewrittenText: 'Technology is very important in education. I agree with this opinion...',
    summary: 'Good range of ideas; watch out for the verb "agree".',
  };
}

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: EntityManager) => Promise<T>) => work({} as EntityManager),
} as unknown as DataSource;

interface MakeServiceOverrides {
  submission?: WritingSubmission | null;
  lockedSubmission?: WritingSubmission | null;
  task?: WritingTask | null;
  gradeSubmission?: (
    id: string,
    userId: string,
    data: GradeSubmissionData,
  ) => Promise<{ affected?: number | null }>;
}

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
  overrides: MakeServiceOverrides = {},
): {
  service: SubmitWritingSubmissionService;
  gradeCalls: { id: string; userId: string; data: GradeSubmissionData }[];
  llmCallCount: () => number;
  createAiLinkedActivityCalls: unknown[];
} {
  const gradeCalls: { id: string; userId: string; data: GradeSubmissionData }[] = [];
  const createAiLinkedActivityCalls: unknown[] = [];
  let llmCalls = 0;
  const llm: LLMServicePort = {
    completeStructured: async (...args) => {
      llmCalls += 1;
      return completeStructured(...args);
    },
  };

  const submission = overrides.submission === undefined ? makeSubmission() : overrides.submission;
  const lockedSubmission =
    overrides.lockedSubmission === undefined ? submission : overrides.lockedSubmission;
  const task = overrides.task === undefined ? makeTask() : overrides.task;

  const writingSubmissions = (): WritingSubmissionsRepositoryPort => ({
    findByIdForUser: async () => submission,
    findByIdForUpdate: async () => lockedSubmission,
    gradeSubmission: async (id, userId, data) => {
      gradeCalls.push({ id, userId, data });
      if (overrides.gradeSubmission) return overrides.gradeSubmission(id, userId, data);
      return { affected: 1 };
    },
  });
  const writingTasks = (): WritingTasksRepositoryPort => ({
    findByIdForUser: async () => task,
  });

  const service = new SubmitWritingSubmissionService(FAKE_DATA_SOURCE, {
    llm,
    writingSubmissions,
    writingTasks,
    createAiLinkedActivity: async (_manager, input) => {
      createAiLinkedActivityCalls.push(input);
    },
  });
  return { service, gradeCalls, llmCallCount: () => llmCalls, createAiLinkedActivityCalls };
}

function assertErr(err: unknown, code: SubmitWritingSubmissionErrorCode): true {
  assert.ok(err instanceof SubmitWritingSubmissionError);
  assert.equal(err.code, code);
  return true;
}

const SUBMITTED_AT = new Date('2026-01-01T10:35:00.000Z');

describe('SubmitWritingSubmissionService.execute — happy path', () => {
  it('grades, computes overallBand as the sum of the 4 criteria bands, and persists', async () => {
    const { service, gradeCalls } = makeService(async () => validGradingResponse());
    const { result, idempotentReplay } = await service.execute(
      USER_ID,
      SUBMISSION_ID,
      SUBMITTED_TEXT,
      SUBMITTED_AT,
    );

    assert.equal(idempotentReplay, false);
    assert.equal(result.feedback.overallBand, 4 + 3 + 4 + 2);
    assert.equal(result.feedback.maxBand, 20);
    assert.equal(gradeCalls.length, 1);
    assert.equal(gradeCalls[0]!.data.feedback.overallBand, 13);
  });

  it('computes word count and duration from the submitted text and timestamps', async () => {
    const { service } = makeService(async () => validGradingResponse());
    const { result } = await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);

    assert.equal(result.wordCount, SUBMITTED_TEXT.trim().split(/\s+/).length);
    assert.equal(result.durationSeconds, 35 * 60);
  });

  it('assigns sequential string ids to persisted corrections', async () => {
    const { service } = makeService(async () => ({
      ...validGradingResponse(),
      corrections: [
        validGradingResponse().corrections[0],
        {
          originalExcerpt: 'schools should use more tablets',
          correctedExcerpt: 'schools should use more tablets and laptops',
          explanation: 'Add a second example for a stronger point.',
          category: 'vocabulary',
        },
      ],
    }));
    const { result } = await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);
    assert.deepEqual(
      result.feedback.corrections.map((c) => c.id),
      ['0', '1'],
    );
  });
});

describe('SubmitWritingSubmissionService.execute — grading response validation', () => {
  it('rejects a response with fewer than 4 criteria', async () => {
    const { service } = makeService(async () => ({
      ...validGradingResponse(),
      criteria: validGradingResponse().criteria.slice(0, 3),
    }));
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a duplicated criterion', async () => {
    const response = validGradingResponse();
    response.criteria[3] = { ...response.criteria[0] };
    const { service } = makeService(async () => response);
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a band outside 0-5', async () => {
    const response = validGradingResponse();
    response.criteria[0]!.band = 6;
    const { service } = makeService(async () => response);
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a non-integer band', async () => {
    const response = validGradingResponse();
    response.criteria[0]!.band = 3.5;
    const { service } = makeService(async () => response);
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('drops a fabricated evidence quote that is not a real substring, keeps the criterion', async () => {
    const response = validGradingResponse();
    response.criteria[0]!.evidenceQuotes = ['this sentence was never written by the student'];
    const { service } = makeService(async () => response);
    const { result } = await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);
    assert.deepEqual(result.feedback.criteria[0]!.evidenceQuotes, []);
    assert.equal(result.feedback.criteria[0]!.band, 4);
  });

  it('is whitespace/case-tolerant when verifying a real evidence quote', async () => {
    const response = validGradingResponse();
    response.criteria[0]!.evidenceQuotes = ['TECHNOLOGY   is very   important in education'];
    const { service } = makeService(async () => response);
    const { result } = await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);
    assert.equal(result.feedback.criteria[0]!.evidenceQuotes.length, 1);
  });

  it('drops a correction whose originalExcerpt is not a real substring of the submitted text', async () => {
    const response = validGradingResponse();
    response.corrections.push({
      originalExcerpt: 'a sentence the student never wrote',
      correctedExcerpt: 'a corrected version',
      explanation: 'fabricated',
      category: 'grammar',
    });
    const { service } = makeService(async () => response);
    const { result } = await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);
    assert.equal(result.feedback.corrections.length, 1);
    assert.equal(result.feedback.corrections[0]!.originalExcerpt, 'I am agree with this opinion');
  });

  it('coerces an invalid correction category to "other" instead of rejecting the whole response', async () => {
    const response = validGradingResponse();
    response.corrections[0]!.category = 'made_up_category' as never;
    const { service } = makeService(async () => response);
    const { result } = await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);
    assert.equal(result.feedback.corrections[0]!.category, 'other');
  });

  it('rejects a missing rewrittenText', async () => {
    const response = validGradingResponse() as Record<string, unknown>;
    delete response.rewrittenText;
    const { service } = makeService(async () => response);
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE),
    );
  });
});

describe('SubmitWritingSubmissionService.execute — input validation', () => {
  it('rejects an empty submittedText', async () => {
    const { service } = makeService(async () => validGradingResponse());
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, '   ', SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a non-string submittedText', async () => {
    const { service } = makeService(async () => validGradingResponse());
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, 12345, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.INVALID_INPUT),
    );
  });
});

describe('SubmitWritingSubmissionService.execute — status handling', () => {
  it('not found -> SUBMISSION_NOT_FOUND', async () => {
    const { service, llmCallCount } = makeService(async () => validGradingResponse(), {
      submission: null,
    });
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('abandoned -> SUBMISSION_ABANDONED, never calls the LLM', async () => {
    const { service, llmCallCount } = makeService(async () => validGradingResponse(), {
      submission: makeSubmission({ status: WritingSubmissionStatus.ABANDONED }),
    });
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.SUBMISSION_ABANDONED),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('already graded -> idempotent replay, never calls the LLM again', async () => {
    const feedback = {
      version: 'writing-feedback-v1' as const,
      criteria: [],
      overallBand: 10,
      maxBand: 20 as const,
      corrections: [],
      rewrittenText: 'already graded',
      summary: 'already graded',
    };
    const graded = makeSubmission({
      status: WritingSubmissionStatus.GRADED,
      submitted_at: new Date('2026-01-01T10:30:00.000Z'),
      duration_seconds: 1800,
      submitted_text: 'previously submitted text',
      word_count: 3,
      feedback,
    });
    const { service, llmCallCount } = makeService(async () => validGradingResponse(), {
      submission: graded,
    });
    const { result, idempotentReplay } = await service.execute(
      USER_ID,
      SUBMISSION_ID,
      SUBMITTED_TEXT,
      SUBMITTED_AT,
    );
    assert.equal(idempotentReplay, true);
    assert.equal(result.submittedText, 'previously submitted text');
    assert.equal(llmCallCount(), 0);
  });

  it('a concurrent submit wins the race — the locked re-read is already graded, so this result is discarded and theirs is replayed', async () => {
    const winnerFeedback = {
      version: 'writing-feedback-v1' as const,
      criteria: [],
      overallBand: 8,
      maxBand: 20 as const,
      corrections: [],
      rewrittenText: 'the other request won',
      summary: 'the other request won',
    };
    const winner = makeSubmission({
      status: WritingSubmissionStatus.GRADED,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 100,
      submitted_text: 'winner text',
      word_count: 2,
      feedback: winnerFeedback,
    });
    const { service, gradeCalls } = makeService(async () => validGradingResponse(), {
      submission: makeSubmission(), // in_progress on the pre-check
      lockedSubmission: winner, // already graded by the time we get the lock
    });
    const { result, idempotentReplay } = await service.execute(
      USER_ID,
      SUBMISSION_ID,
      SUBMITTED_TEXT,
      SUBMITTED_AT,
    );
    assert.equal(idempotentReplay, true);
    assert.equal(result.submittedText, 'winner text');
    assert.equal(gradeCalls.length, 0);
  });
});

describe('SubmitWritingSubmissionService.execute — AI-linked planned activity', () => {
  const PLAN_DAY_ID = '33333333-3333-3333-3333-333333333333';

  it('creates a linked planned_activity when the submission targets a plan day', async () => {
    const { service, createAiLinkedActivityCalls } = makeService(
      async () => validGradingResponse(),
      { submission: makeSubmission({ plan_day_id: PLAN_DAY_ID }) },
    );
    await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);

    assert.equal(createAiLinkedActivityCalls.length, 1);
    const input = createAiLinkedActivityCalls[0] as Record<string, unknown>;
    assert.equal(input.planDayId, PLAN_DAY_ID);
    assert.equal(input.skillSlug, 'writing');
    assert.equal(input.examSectionSlug, 'writing-part-1'); // essay
    assert.equal(input.writingSubmissionId, SUBMISSION_ID);
    assert.equal(input.completedAt, SUBMITTED_AT);
  });

  it('does not create a planned_activity when the submission has no target day', async () => {
    const { service, createAiLinkedActivityCalls } = makeService(async () =>
      validGradingResponse(),
    );
    await service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT);
    assert.equal(createAiLinkedActivityCalls.length, 0);
  });

  it('does not create a duplicate planned_activity on an idempotent replay', async () => {
    const feedback = {
      version: 'writing-feedback-v1' as const,
      criteria: [],
      overallBand: 10,
      maxBand: 20 as const,
      corrections: [],
      rewrittenText: 'already graded',
      summary: 'already graded',
    };
    const graded = makeSubmission({
      status: WritingSubmissionStatus.GRADED,
      plan_day_id: PLAN_DAY_ID,
      submitted_at: new Date('2026-01-01T10:30:00.000Z'),
      duration_seconds: 1800,
      submitted_text: 'previously submitted text',
      word_count: 3,
      feedback,
    });
    const { service, createAiLinkedActivityCalls } = makeService(
      async () => validGradingResponse(),
      { submission: graded },
    );
    const { idempotentReplay } = await service.execute(
      USER_ID,
      SUBMISSION_ID,
      SUBMITTED_TEXT,
      SUBMITTED_AT,
    );
    assert.equal(idempotentReplay, true);
    assert.equal(createAiLinkedActivityCalls.length, 0);
  });
});

describe('SubmitWritingSubmissionService.execute — LLM provider failures', () => {
  it('maps a timeout to AI_REQUEST_TIMEOUT', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('timed out', LLMErrorCode.TIMEOUT);
    });
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_REQUEST_TIMEOUT),
    );
  });

  it('maps a rate limit to AI_RATE_LIMITED', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('rate limited', LLMErrorCode.RATE_LIMITED);
    });
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, SUBMITTED_TEXT, SUBMITTED_AT),
      (err: unknown) => assertErr(err, SubmitWritingSubmissionErrorCode.AI_RATE_LIMITED),
    );
  });
});
