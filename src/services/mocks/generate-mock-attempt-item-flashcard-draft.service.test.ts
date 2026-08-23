import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  GenerateMockAttemptItemFlashcardDraftService,
  GenerateMockAttemptItemFlashcardDraftError,
  GenerateMockAttemptItemFlashcardDraftErrorCode,
} from './generate-mock-attempt-item-flashcard-draft.service';
import type {
  MockAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  ListeningSourcesRepositoryPort,
} from './generate-mock-attempt-item-flashcard-draft.service';
import { MockAttemptSectionStatus, MockAttemptSectionContentType } from '@models/enums';
import type { MockAttemptSection } from '@models/MockAttemptSection';
import type { PracticeExercise } from '@models/PracticeExercise';
import type { PracticeItem } from '@models/PracticeItem';
import type { FlashcardDraftGeneratorPort } from '../flashcards/flashcard-draft-generator';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';
import { FlashcardType, EnglishLevel } from '@models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const NOW = new Date('2026-01-01T10:00:00Z');
const FAKE_DATA_SOURCE = {} as DataSource;

function makeSection(overrides: Partial<MockAttemptSection> = {}): MockAttemptSection {
  return {
    id: 'section-1',
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
          answer: { kind: 'single_choice', optionId: 'b' },
          responseTimeMs: null,
        },
      ],
    },
    raw_score: '0.00',
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

const EXERCISE = {
  stimulus: 'A short passage.',
  target_level: EnglishLevel.B2,
} as PracticeExercise;

const DRAFT = {
  type: FlashcardType.GRAMMAR,
  front: 'be vs is',
  back: 'Use "is" for third person singular present simple.',
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
  items?: PracticeItem[];
  generatorError?: FlashcardDraftGenerationError;
}) {
  const mockAttempts: MockAttemptsRepositoryPort = {
    findSectionByCodeForUser: async () => opts.section,
  };
  const practiceExercises: PracticeExercisesRepositoryPort = {
    findExerciseWithAnswerKeysForEvaluation: async () => ({
      exercise: EXERCISE,
      items: opts.items ?? [ITEM],
    }),
  };
  const listeningSources: ListeningSourcesRepositoryPort = {
    findItemsWithAnswerKeysBySourceId: async () => [],
  };
  const generator: FlashcardDraftGeneratorPort = {
    generateFromTerm: async () => DRAFT,
    generateFromPracticeError: async () => {
      if (opts.generatorError) throw opts.generatorError;
      return DRAFT;
    },
    generateFromWritingCorrection: async () => DRAFT,
  };
  return new GenerateMockAttemptItemFlashcardDraftService(FAKE_DATA_SOURCE, {
    generator,
    mockAttempts: () => mockAttempts,
    practiceExercises: () => practiceExercises,
    listeningSources: () => listeningSources,
  });
}

describe('GenerateMockAttemptItemFlashcardDraftService.execute', () => {
  it('generates a draft for an item answered incorrectly', async () => {
    const service = makeService({ section: makeSection() });

    const result = await service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', 'item-1');

    assert.deepEqual(result.draft, DRAFT);
  });

  it('rejects converting an item that was actually answered correctly', async () => {
    const section = makeSection({
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
    });
    const service = makeService({ section });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', 'item-1'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptItemFlashcardDraftError);
        assert.equal(err.code, GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_INCORRECT);
        return true;
      },
    );
  });

  it('rejects a section that has not been graded yet', async () => {
    const service = makeService({
      section: makeSection({ status: MockAttemptSectionStatus.IN_PROGRESS, answers: [] }),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', 'item-1'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptItemFlashcardDraftError);
        assert.equal(
          err.code,
          GenerateMockAttemptItemFlashcardDraftErrorCode.SECTION_NOT_COMPLETED,
        );
        return true;
      },
    );
  });

  it('rejects an unknown item', async () => {
    const service = makeService({ section: makeSection(), items: [] });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', 'item-1'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptItemFlashcardDraftError);
        assert.equal(err.code, GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_FOUND);
        return true;
      },
    );
  });

  it('rejects an unknown section', async () => {
    const service = makeService({ section: null });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', 'item-1'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptItemFlashcardDraftError);
        assert.equal(err.code, GenerateMockAttemptItemFlashcardDraftErrorCode.SECTION_NOT_FOUND);
        return true;
      },
    );
  });

  it('maps a generator failure to its own AI error code', async () => {
    const service = makeService({
      section: makeSection(),
      generatorError: new FlashcardDraftGenerationError(
        'rate limited',
        FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED,
      ),
    });

    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, 'uoe-part-1', 'item-1'),
      (err: unknown) => {
        assert.ok(err instanceof GenerateMockAttemptItemFlashcardDraftError);
        assert.equal(err.code, GenerateMockAttemptItemFlashcardDraftErrorCode.AI_RATE_LIMITED);
        return true;
      },
    );
  });
});
