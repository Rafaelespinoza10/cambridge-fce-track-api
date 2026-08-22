import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GetDailySessionSubmissionService,
  DailySessionSubmissionError,
  DailySessionSubmissionErrorCode,
} from './get-daily-session-submission.service';
import { DailySessionSubmissionStatus } from '../../models/enums';
import type { DailySessionSubmission } from '../../models/DailySessionSubmission';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SUBMISSION_ID = '22222222-2222-2222-2222-222222222222';

function makeGradedSubmission(): DailySessionSubmission {
  return {
    id: SUBMISSION_ID,
    daily_session_id: 'session-id',
    status: DailySessionSubmissionStatus.GRADED,
    started_at: new Date('2026-08-21T11:50:00.000Z'),
    submitted_at: new Date('2026-08-21T12:00:00.000Z'),
    duration_seconds: 600,
    comprehension_answers: [],
    comprehension_correct_count: 4,
    comprehension_total_count: 5,
    comprehension_percentage: '80',
    sentence_submissions: [],
    sentence_feedback: {
      version: 'daily-session-sentence-feedback-v1',
      items: [],
      correctCount: 2,
      totalCount: 3,
    },
  } as unknown as DailySessionSubmission;
}

function makeInProgressSubmission(): DailySessionSubmission {
  return {
    id: SUBMISSION_ID,
    daily_session_id: 'session-id',
    status: DailySessionSubmissionStatus.IN_PROGRESS,
    started_at: new Date('2026-08-21T11:50:00.000Z'),
    submitted_at: null,
    duration_seconds: null,
    comprehension_answers: null,
    comprehension_correct_count: null,
    comprehension_total_count: null,
    comprehension_percentage: null,
    sentence_submissions: null,
    sentence_feedback: null,
  } as unknown as DailySessionSubmission;
}

describe('GetDailySessionSubmissionService.getSubmission', () => {
  it('returns result populated for a graded submission', async () => {
    const service = new GetDailySessionSubmissionService({
      repository: { findByIdForUser: async () => makeGradedSubmission() },
    });
    const view = await service.getSubmission(USER_ID, SUBMISSION_ID);

    assert.equal(view.submission.status, 'graded');
    assert.ok(view.result !== null);
    assert.equal(view.result?.comprehensionCorrectCount, 4);
    assert.equal(view.result?.sentenceFeedback.correctCount, 2);
  });

  it('returns result: null for an in_progress submission — never guesses or partially fills it', async () => {
    const service = new GetDailySessionSubmissionService({
      repository: { findByIdForUser: async () => makeInProgressSubmission() },
    });
    const view = await service.getSubmission(USER_ID, SUBMISSION_ID);

    assert.equal(view.submission.status, 'in_progress');
    assert.equal(view.result, null);
  });

  it('throws SUBMISSION_NOT_FOUND when the repository finds nothing', async () => {
    const service = new GetDailySessionSubmissionService({
      repository: { findByIdForUser: async () => null },
    });
    await assert.rejects(
      () => service.getSubmission(USER_ID, SUBMISSION_ID),
      (err) => {
        assert.ok(err instanceof DailySessionSubmissionError);
        assert.equal(err.code, DailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND);
        return true;
      },
    );
  });
});
