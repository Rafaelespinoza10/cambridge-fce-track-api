import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, EntityManager } from 'typeorm';

import {
  SubmitDailySessionSubmissionService,
  SubmitDailySessionSubmissionError,
  SubmitDailySessionSubmissionErrorCode,
} from './submit-daily-session-submission.service';
import type {
  LLMServicePort,
  DailySessionsRepositoryPort,
  DailySessionSubmissionsRepositoryPort,
} from './submit-daily-session-submission.service';
import { DailySessionSubmissionStatus } from '../../models/enums';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import type { DailySessionWithAnswerKeysForEvaluation } from '@repositories/daily-session/daily-sessions.repository';
import type { DailySession } from '../../models/DailySession';
import type { DailySessionItem } from '../../models/DailySessionItem';
import type { DailySessionSubmission } from '../../models/DailySessionSubmission';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SUBMISSION_ID = '22222222-2222-2222-2222-222222222222';
const SESSION_ID = '33333333-3333-3333-3333-333333333333';
const SUBMITTED_AT = new Date('2026-08-21T12:00:00.000Z');
const STARTED_AT = new Date('2026-08-21T11:50:00.000Z');

const TARGETS = [
  { id: 'target-1', targetText: 'thrive', hint: 'verb' },
  { id: 'target-2', targetText: 'sustainable', hint: 'adjective' },
];

function makeItem(id: string, position: number, acceptedOptionId: string): DailySessionItem {
  return {
    id,
    daily_session_id: SESSION_ID,
    position,
    prompt: `Prompt ${position}`,
    options: [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ],
    answer_key: { kind: 'single_choice', acceptedOptionIds: [acceptedOptionId] },
    explanation: 'Because.',
    skill_tags: ['detail'],
  } as DailySessionItem;
}

function makeSession(): DailySession {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    session_date: '2026-08-21',
    target_level: 'B2',
    reading_title: 'The Rise of Urban Beekeeping',
    sentence_targets: TARGETS,
  } as unknown as DailySession;
}

function makeInProgressSubmission(): DailySessionSubmission {
  return {
    id: SUBMISSION_ID,
    user_id: USER_ID,
    daily_session_id: SESSION_ID,
    status: DailySessionSubmissionStatus.IN_PROGRESS,
    started_at: STARTED_AT,
    submitted_at: null,
  } as unknown as DailySessionSubmission;
}

function validSentenceGradingResponse() {
  return {
    items: [
      {
        targetIndex: 1,
        usesTargetCorrectly: true,
        feedback: 'Good use of "thrive" in context.',
        correctedSentence: null,
        evidenceQuote: 'plants thrive in the shade',
      },
      {
        targetIndex: 2,
        usesTargetCorrectly: false,
        feedback: 'This is not a sustainable use of the word.',
        correctedSentence: 'We need a sustainable energy policy.',
        evidenceQuote: 'sustainable is a big word',
      },
    ],
  };
}

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: EntityManager) => Promise<T>) => work({} as EntityManager),
} as unknown as DataSource;

interface MakeServiceOverrides {
  session?: DailySessionWithAnswerKeysForEvaluation | null;
  submission?: DailySessionSubmission | null;
  lockedSubmission?: DailySessionSubmission | null;
  gradeSubmissionAffected?: number;
}

interface RepoCalls {
  gradeSubmission: unknown[];
  createAiLinkedActivity: unknown[];
}

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
  overrides: MakeServiceOverrides = {},
): { service: SubmitDailySessionSubmissionService; calls: RepoCalls; llmCallCount: () => number } {
  const calls: RepoCalls = { gradeSubmission: [], createAiLinkedActivity: [] };
  let llmCalls = 0;
  const llm: LLMServicePort = {
    completeStructured: async (...args) => {
      llmCalls += 1;
      return completeStructured(...args);
    },
  };

  const defaultSession: DailySessionWithAnswerKeysForEvaluation = {
    session: makeSession(),
    items: [makeItem('item-1', 1, 'a'), makeItem('item-2', 2, 'a')],
  };

  const dailySessions = (): DailySessionsRepositoryPort => ({
    findSessionWithAnswerKeysForEvaluation: async () =>
      overrides.session === undefined ? defaultSession : overrides.session,
  });

  const dailySessionSubmissions = (): DailySessionSubmissionsRepositoryPort => ({
    findByIdForUser: async () =>
      overrides.submission === undefined ? makeInProgressSubmission() : overrides.submission,
    findByIdForUpdate: async () =>
      overrides.lockedSubmission === undefined
        ? makeInProgressSubmission()
        : overrides.lockedSubmission,
    gradeSubmission: async (submissionId, userId, data) => {
      calls.gradeSubmission.push({ submissionId, userId, data });
      return { affected: overrides.gradeSubmissionAffected ?? 1 };
    },
  });

  const service = new SubmitDailySessionSubmissionService(FAKE_DATA_SOURCE, {
    llm,
    dailySessions,
    dailySessionSubmissions,
    createAiLinkedActivity: async (_manager, input) => {
      calls.createAiLinkedActivity.push(input);
      return {};
    },
    resolvePlanDayId: async () => 'plan-day-id',
  });

  return { service, calls, llmCallCount: () => llmCalls };
}

function validInput() {
  return {
    comprehensionAnswers: [
      { itemId: 'item-1', answerPayload: { kind: 'single_choice', optionId: 'a' } },
      { itemId: 'item-2', answerPayload: { kind: 'single_choice', optionId: 'b' } },
    ],
    sentenceSubmissions: [
      { targetId: 'target-1', submittedSentence: 'Many plants thrive in the shade.' },
      { targetId: 'target-2', submittedSentence: 'sustainable is a big word, I like it.' },
    ],
  };
}

function assertErr(err: unknown, code: SubmitDailySessionSubmissionErrorCode): true {
  assert.ok(err instanceof SubmitDailySessionSubmissionError);
  assert.equal(err.code, code);
  return true;
}

// ── happy path ───────────────────────────────────────────────────────────────

describe('SubmitDailySessionSubmissionService.execute — happy path', () => {
  it('grades comprehension deterministically and sentences via the LLM, then persists and registers the plan activity', async () => {
    const { service, calls } = makeService(async () => validSentenceGradingResponse());
    const result = await service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT);

    assert.equal(result.idempotentReplay, false);
    assert.equal(result.result.comprehensionCorrectCount, 1); // item-1 correct (a), item-2 wrong (b, key is a)
    assert.equal(result.result.comprehensionTotalCount, 2);
    assert.equal(result.result.comprehensionPercentage, 50);
    assert.equal(result.result.sentenceFeedback.correctCount, 1);
    assert.equal(result.result.sentenceFeedback.totalCount, 2);

    assert.equal(calls.gradeSubmission.length, 1);
    assert.equal(calls.createAiLinkedActivity.length, 1);
    const linked = calls.createAiLinkedActivity[0] as { dailySessionSubmissionId: string };
    assert.equal(linked.dailySessionSubmissionId, SUBMISSION_ID);
  });

  it("never trusts the model's own correctCount — always recomputed from usesTargetCorrectly", async () => {
    const { service } = makeService(async () => ({
      items: [
        {
          targetIndex: 1,
          usesTargetCorrectly: true,
          feedback: 'ok',
          correctedSentence: null,
          evidenceQuote: null,
        },
        {
          targetIndex: 2,
          usesTargetCorrectly: true,
          feedback: 'ok',
          correctedSentence: null,
          evidenceQuote: null,
        },
      ],
    }));
    const result = await service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT);
    assert.equal(result.result.sentenceFeedback.correctCount, 2);
  });

  it("drops an evidenceQuote that is not a real substring of that target's own submitted sentence", async () => {
    const { service } = makeService(async () => ({
      items: [
        {
          targetIndex: 1,
          usesTargetCorrectly: true,
          feedback: 'ok',
          correctedSentence: null,
          evidenceQuote: 'this text was never actually written by the student',
        },
        {
          targetIndex: 2,
          usesTargetCorrectly: true,
          feedback: 'ok',
          correctedSentence: null,
          evidenceQuote: 'sustainable is a big word', // real substring of target-2's sentence
        },
      ],
    }));
    const result = await service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT);
    const item1 = result.result.sentenceFeedback.items.find((i) => i.targetId === 'target-1');
    const item2 = result.result.sentenceFeedback.items.find((i) => i.targetId === 'target-2');
    assert.equal(item1?.evidenceQuote, null);
    assert.equal(item2?.evidenceQuote, 'sustainable is a big word');
  });

  it('treats an item omitted from comprehensionAnswers as unanswered (incorrect), same lenience as Practice', async () => {
    const { service } = makeService(async () => validSentenceGradingResponse());
    const input = validInput();
    input.comprehensionAnswers = [input.comprehensionAnswers[0]!]; // item-2 omitted
    const result = await service.execute(USER_ID, SUBMISSION_ID, input, SUBMITTED_AT);
    assert.equal(result.result.comprehensionCorrectCount, 1);
    assert.equal(result.result.comprehensionTotalCount, 2);
  });
});

// ── idempotency / status handling ───────────────────────────────────────────

describe('SubmitDailySessionSubmissionService.execute — status handling', () => {
  it('replays without calling the LLM when the submission is already graded', async () => {
    const graded = {
      ...makeInProgressSubmission(),
      status: DailySessionSubmissionStatus.GRADED,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 60,
      comprehension_answers: [],
      comprehension_correct_count: 1,
      comprehension_total_count: 2,
      comprehension_percentage: '50',
      sentence_submissions: [],
      sentence_feedback: {
        version: 'daily-session-sentence-feedback-v1',
        items: [],
        correctCount: 0,
        totalCount: 0,
      },
    } as unknown as DailySessionSubmission;

    const { service, llmCallCount } = makeService(async () => validSentenceGradingResponse(), {
      submission: graded,
    });
    const result = await service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT);
    assert.equal(result.idempotentReplay, true);
    assert.equal(llmCallCount(), 0);
  });

  it('rejects submitting an abandoned submission', async () => {
    const abandoned = {
      ...makeInProgressSubmission(),
      status: DailySessionSubmissionStatus.ABANDONED,
    } as DailySessionSubmission;
    const { service } = makeService(async () => validSentenceGradingResponse(), {
      submission: abandoned,
    });
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT),
      (err) => assertErr(err, SubmitDailySessionSubmissionErrorCode.SUBMISSION_ABANDONED),
    );
  });

  it('discards an already-paid-for LLM result and replays the winner when it loses a race under the row lock', async () => {
    const gradedByWinner = {
      ...makeInProgressSubmission(),
      status: DailySessionSubmissionStatus.GRADED,
      submitted_at: SUBMITTED_AT,
      duration_seconds: 60,
      comprehension_answers: [],
      comprehension_correct_count: 2,
      comprehension_total_count: 2,
      comprehension_percentage: '100',
      sentence_submissions: [],
      sentence_feedback: {
        version: 'daily-session-sentence-feedback-v1',
        items: [],
        correctCount: 2,
        totalCount: 2,
      },
    } as unknown as DailySessionSubmission;

    const { service, llmCallCount, calls } = makeService(
      async () => validSentenceGradingResponse(),
      {
        lockedSubmission: gradedByWinner,
      },
    );
    const result = await service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT);
    assert.equal(result.idempotentReplay, true);
    assert.equal(result.result.comprehensionCorrectCount, 2); // the winner's result, not ours
    assert.equal(llmCallCount(), 1); // the LLM call still happened (paid for) before the race was detected
    assert.equal(calls.gradeSubmission.length, 0); // but nothing of ours was persisted
  });

  it('rejects a missing submission', async () => {
    const { service } = makeService(async () => validSentenceGradingResponse(), {
      submission: null,
    });
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, validInput(), SUBMITTED_AT),
      (err) => assertErr(err, SubmitDailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND),
    );
  });
});

// ── input validation ─────────────────────────────────────────────────────────

describe('SubmitDailySessionSubmissionService.execute — input validation', () => {
  it('rejects a sentenceSubmissions array with the wrong length', async () => {
    const { service } = makeService(async () => validSentenceGradingResponse());
    const input = validInput();
    input.sentenceSubmissions = [input.sentenceSubmissions[0]!];
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, input, SUBMITTED_AT),
      (err) => assertErr(err, SubmitDailySessionSubmissionErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a sentenceSubmissions targetId that does not belong to this session', async () => {
    const { service } = makeService(async () => validSentenceGradingResponse());
    const input = validInput();
    input.sentenceSubmissions[0] = { targetId: 'not-a-real-target', submittedSentence: 'x' };
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, input, SUBMITTED_AT),
      (err) => assertErr(err, SubmitDailySessionSubmissionErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a duplicate answer for the same comprehension item', async () => {
    const { service } = makeService(async () => validSentenceGradingResponse());
    const input = validInput();
    input.comprehensionAnswers.push(input.comprehensionAnswers[0]!);
    await assert.rejects(
      () => service.execute(USER_ID, SUBMISSION_ID, input, SUBMITTED_AT),
      (err) => assertErr(err, SubmitDailySessionSubmissionErrorCode.INVALID_INPUT),
    );
  });
});
