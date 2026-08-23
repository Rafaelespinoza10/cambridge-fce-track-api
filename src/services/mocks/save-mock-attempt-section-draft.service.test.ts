import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  SaveMockAttemptSectionDraftService,
  SaveMockAttemptSectionDraftError,
  SaveMockAttemptSectionDraftErrorCode,
} from './save-mock-attempt-section-draft.service';
import type { MockAttemptsRepositoryPort } from './save-mock-attempt-section-draft.service';
import {
  ExamType,
  MockAttemptStatus,
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
} from '@models/enums';
import type { MockAttempt } from '@models/MockAttempt';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { MockAttemptSectionAnswers } from '@models/mock-attempt-json-types';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const NOW = new Date('2026-01-01T10:00:00Z');
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
    practice_exercise_id: 'exercise-1',
    writing_task_id: null,
    listening_source_id: null,
    status: MockAttemptSectionStatus.IN_PROGRESS,
    time_limit_seconds: 900,
    started_at: NOW,
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

function makeService(opts: { attempt?: MockAttempt | null; section: MockAttemptSection | null }) {
  const saveCalls: { sectionId: string; answers: MockAttemptSectionAnswers }[] = [];
  const repo: MockAttemptsRepositoryPort = {
    findByIdForUser: async () => (opts.attempt === undefined ? makeAttempt() : opts.attempt),
    findSectionByCodeForUser: async () => opts.section,
    saveSectionDraftAnswers: async (sectionId, answers) => {
      saveCalls.push({ sectionId, answers });
    },
  };
  const service = new SaveMockAttemptSectionDraftService(FAKE_DATA_SOURCE, {
    mockAttempts: () => repo,
  });
  return { service, saveCalls };
}

describe('SaveMockAttemptSectionDraftService.execute', () => {
  it('saves a partial objective-answers draft without grading it', async () => {
    const { service, saveCalls } = makeService({ section: makeSection() });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', {
      answers: [{ itemId: 'item-1', answer: { kind: 'single_choice', optionId: 'a' } }],
    });

    assert.deepEqual(result, { saved: true });
    assert.equal(saveCalls.length, 1);
    assert.deepEqual(saveCalls[0]?.answers, {
      kind: 'objective',
      answers: [
        {
          itemId: 'item-1',
          answer: { kind: 'single_choice', optionId: 'a' },
          responseTimeMs: null,
        },
      ],
    });
  });

  it('saves a partial writing draft', async () => {
    const section = makeSection({
      section_code: 'writing-part-1',
      content_type: MockAttemptSectionContentType.WRITING_TASK,
      practice_exercise_id: null,
      writing_task_id: 'task-1',
    });
    const { service, saveCalls } = makeService({ section });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', {
      content: 'Half an essay...',
    });

    assert.deepEqual(result, { saved: true });
    assert.deepEqual(saveCalls[0]?.answers, { kind: 'writing', content: 'Half an essay...' });
  });

  it('rejects a draft for a section that has not been started yet', async () => {
    const { service } = makeService({
      section: makeSection({ status: MockAttemptSectionStatus.PENDING }),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }),
      (err: unknown) => {
        assert.ok(err instanceof SaveMockAttemptSectionDraftError);
        assert.equal(err.code, SaveMockAttemptSectionDraftErrorCode.SECTION_NOT_STARTED);
        return true;
      },
    );
  });

  it('rejects a draft for an already-completed section — its result is final', async () => {
    const { service } = makeService({
      section: makeSection({ status: MockAttemptSectionStatus.COMPLETED }),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }),
      (err: unknown) => {
        assert.ok(err instanceof SaveMockAttemptSectionDraftError);
        assert.equal(err.code, SaveMockAttemptSectionDraftErrorCode.SECTION_ALREADY_COMPLETED);
        return true;
      },
    );
  });

  it('rejects when the attempt is not in progress', async () => {
    const { service } = makeService({
      attempt: makeAttempt({ status: MockAttemptStatus.ABANDONED }),
      section: makeSection(),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }),
      (err: unknown) => {
        assert.ok(err instanceof SaveMockAttemptSectionDraftError);
        assert.equal(err.code, SaveMockAttemptSectionDraftErrorCode.ATTEMPT_NOT_ACTIVE);
        return true;
      },
    );
  });

  it('rejects an unknown attempt', async () => {
    const { service } = makeService({ attempt: null, section: makeSection() });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }),
      (err: unknown) => {
        assert.ok(err instanceof SaveMockAttemptSectionDraftError);
        assert.equal(err.code, SaveMockAttemptSectionDraftErrorCode.ATTEMPT_NOT_FOUND);
        return true;
      },
    );
  });

  it('rejects an unknown section', async () => {
    const { service } = makeService({ section: null });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', { answers: [] }),
      (err: unknown) => {
        assert.ok(err instanceof SaveMockAttemptSectionDraftError);
        assert.equal(err.code, SaveMockAttemptSectionDraftErrorCode.SECTION_NOT_FOUND);
        return true;
      },
    );
  });

  it('rejects a malformed answer entry', async () => {
    const { service } = makeService({ section: makeSection() });

    await assert.rejects(
      () =>
        service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', {
          answers: [{ itemId: 'item-1', answer: { kind: 'bogus' } } as never],
        }),
      (err: unknown) => {
        assert.ok(err instanceof SaveMockAttemptSectionDraftError);
        assert.equal(err.code, SaveMockAttemptSectionDraftErrorCode.INVALID_INPUT);
        return true;
      },
    );
  });
});
