import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  GenerateMockAttemptCorrectionFlashcardDraftService,
  GenerateMockAttemptCorrectionFlashcardDraftError,
  GenerateMockAttemptCorrectionFlashcardDraftErrorCode,
} from './generate-mock-attempt-correction-flashcard-draft.service';
import type {
  MockAttemptsRepositoryPort,
  WritingTasksRepositoryPort,
} from './generate-mock-attempt-correction-flashcard-draft.service';
import {
  MockAttemptSectionStatus,
  MockAttemptSectionContentType,
  FlashcardType,
  EnglishLevel,
} from '@models/enums';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { WritingTask } from '@models/WritingTask';
import type { FlashcardDraftGeneratorPort } from '../flashcards/flashcard-draft-generator';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const NOW = new Date('2026-01-01T10:00:00Z');
const FAKE_DATA_SOURCE = {} as DataSource;

function makeSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-1',
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
    answers: { kind: 'writing', content: 'My essay text.' },
    raw_score: '15.00',
    max_score: '20.00',
    grading_feedback: {
      kind: 'writing',
      version: 'writing-feedback-v1',
      criteria: [],
      overallBand: 15,
      maxBand: 20,
      corrections: [
        {
          id: '0',
          originalExcerpt: 'I be happy',
          correctedExcerpt: 'I am happy',
          explanation: 'Subject-verb agreement.',
          category: 'grammar',
        },
      ],
      rewrittenText: 'Rewritten.',
      summary: 'Solid.',
    },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as MockAttemptSection;
}

const TASK = { id: 'task-1', title: 'Essay title', target_level: EnglishLevel.B2 } as WritingTask;

const DRAFT = {
  type: FlashcardType.GRAMMAR,
  front: 'subject-verb agreement',
  back: 'Use "am" with "I".',
  translation: null,
  example: null,
  personalExample: null,
  notes: null,
  sourceName: null,
  sourceUrl: null,
  level: EnglishLevel.B2,
  tags: ['grammar'],
};

function makeService(opts: {
  section: MockAttemptSection | null;
  task?: WritingTask | null;
  generatorError?: FlashcardDraftGenerationError;
}) {
  const mockAttempts: MockAttemptsRepositoryPort = {
    findSectionByCodeForUser: async () => opts.section,
  };
  const writingTasks: WritingTasksRepositoryPort = {
    findByIdForUser: async () => (opts.task === undefined ? TASK : opts.task),
  };
  const generator: FlashcardDraftGeneratorPort = {
    generateFromTerm: async () => DRAFT,
    generateFromPracticeError: async () => DRAFT,
    generateFromWritingCorrection: async () => {
      if (opts.generatorError) throw opts.generatorError;
      return DRAFT;
    },
  };
  return new GenerateMockAttemptCorrectionFlashcardDraftService(FAKE_DATA_SOURCE, {
    generator,
    mockAttempts: () => mockAttempts,
    writingTasks: () => writingTasks,
  });
}

describe('GenerateMockAttemptCorrectionFlashcardDraftService.execute', () => {
  it('generates a draft from a graded correction', async () => {
    const service = makeService({ section: makeSection() });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', '0');

    assert.deepEqual(result.draft, DRAFT);
  });

  it('rejects a section that has not been graded yet', async () => {
    const service = makeService({
      section: makeSection({
        status: MockAttemptSectionStatus.IN_PROGRESS,
        grading_feedback: null,
      }),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', '0'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptCorrectionFlashcardDraftError);
        assert.equal(
          err.code,
          GenerateMockAttemptCorrectionFlashcardDraftErrorCode.SECTION_NOT_GRADED,
        );
        return true;
      },
    );
  });

  it('rejects an unknown correction id', async () => {
    const service = makeService({ section: makeSection() });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', '99'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptCorrectionFlashcardDraftError);
        assert.equal(
          err.code,
          GenerateMockAttemptCorrectionFlashcardDraftErrorCode.CORRECTION_NOT_FOUND,
        );
        return true;
      },
    );
  });

  it('rejects an unknown section', async () => {
    const service = makeService({ section: null });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', '0'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptCorrectionFlashcardDraftError);
        assert.equal(
          err.code,
          GenerateMockAttemptCorrectionFlashcardDraftErrorCode.SECTION_NOT_FOUND,
        );
        return true;
      },
    );
  });

  it('maps a generator failure to its own AI error code', async () => {
    const service = makeService({
      section: makeSection(),
      generatorError: new FlashcardDraftGenerationError(
        'invalid response',
        FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE,
      ),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'writing-part-1', '0'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptCorrectionFlashcardDraftError);
        assert.equal(
          err.code,
          GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_INVALID_RESPONSE,
        );
        return true;
      },
    );
  });
});
