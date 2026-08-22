import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GetMockAttemptSectionResultService,
  GetMockAttemptSectionResultError,
  GetMockAttemptSectionResultErrorCode,
} from './get-mock-attempt-section-result.service';
import { MockAttemptSectionStatus, MockAttemptSectionContentType } from '../../models/enums';
import type { MockAttemptSection } from '../../models/MockAttemptSection';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = '22222222-2222-2222-2222-222222222222';
const SECTION_CODE = 'uoe-part-1';

function makeSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-1',
    mock_attempt_id: ATTEMPT_ID,
    section_code: SECTION_CODE,
    content_type: MockAttemptSectionContentType.PRACTICE_EXERCISE,
    status: MockAttemptSectionStatus.COMPLETED,
    time_limit_seconds: 900,
    started_at: new Date('2026-08-22T10:00:00.000Z'),
    completed_at: new Date('2026-08-22T10:12:00.000Z'),
    raw_score: '6',
    max_score: '8',
    grading_feedback: {
      kind: 'objective',
      version: 'practice-attempt-feedback-v1',
      unansweredCount: 1,
      skillBreakdown: [],
    },
    ...overrides,
  } as unknown as MockAttemptSection;
}

describe('GetMockAttemptSectionResultService.execute', () => {
  it('returns percentage and feedback for a completed section', async () => {
    const service = new GetMockAttemptSectionResultService({
      repository: { findSectionByCodeForUser: async () => makeSection() },
    });

    const view = await service.execute(USER_ID, ATTEMPT_ID, SECTION_CODE);

    assert.equal(view.section.sectionCode, SECTION_CODE);
    assert.equal(view.section.status, 'completed');
    assert.equal(view.percentage, 75); // 6/8
    assert.equal(view.feedback?.kind, 'objective');
  });

  it('computes 0 (never divides by zero) when maxScore is 0', async () => {
    const service = new GetMockAttemptSectionResultService({
      repository: {
        findSectionByCodeForUser: async () => makeSection({ raw_score: '0', max_score: '0' }),
      },
    });

    const view = await service.execute(USER_ID, ATTEMPT_ID, SECTION_CODE);
    assert.equal(view.percentage, 0);
  });

  it('returns nulls for a section that is not completed yet — never a partial/guessed result', async () => {
    const service = new GetMockAttemptSectionResultService({
      repository: {
        findSectionByCodeForUser: async () =>
          makeSection({
            status: MockAttemptSectionStatus.IN_PROGRESS,
            completed_at: null,
            raw_score: null,
            max_score: null,
            grading_feedback: null,
          }),
      },
    });

    const view = await service.execute(USER_ID, ATTEMPT_ID, SECTION_CODE);

    assert.equal(view.section.status, 'in_progress');
    assert.equal(view.percentage, null);
    assert.equal(view.feedback, null);
  });

  it('throws SECTION_NOT_FOUND when the repository finds nothing', async () => {
    const service = new GetMockAttemptSectionResultService({
      repository: { findSectionByCodeForUser: async () => null },
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, SECTION_CODE),
      (err) => {
        assert.ok(err instanceof GetMockAttemptSectionResultError);
        assert.equal(err.code, GetMockAttemptSectionResultErrorCode.SECTION_NOT_FOUND);
        return true;
      },
    );
  });

  it('passes userId through to the repository — ownership is enforced there, never assumed here', async () => {
    const calls: { attemptId: string; sectionCode: string; userId: string }[] = [];
    const service = new GetMockAttemptSectionResultService({
      repository: {
        findSectionByCodeForUser: async (attemptId, sectionCode, userId) => {
          calls.push({ attemptId, sectionCode, userId });
          return makeSection();
        },
      },
    });

    await service.execute(USER_ID, ATTEMPT_ID, SECTION_CODE);

    assert.deepEqual(calls, [
      { attemptId: ATTEMPT_ID, sectionCode: SECTION_CODE, userId: USER_ID },
    ]);
  });
});
