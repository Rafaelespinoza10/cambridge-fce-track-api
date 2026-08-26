import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';

import { RecordPracticeMistakesService } from './record-practice-mistakes.service';
import type {
  MistakesRepositoryPort,
  RecordPracticeMistakesExercise,
  RecordPracticeMistakesGradedItem,
} from './record-practice-mistakes.service';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswerPayload } from '../../models/practice-json-types';
import { EnglishLevel, MistakeSource } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const ATTEMPT_ID = 'attempt-1';
const OCCURRED_AT = new Date('2026-02-01T10:00:00.000Z');

const EXERCISE: RecordPracticeMistakesExercise = {
  id: 'exercise-1',
  exam_code: 'B2_FIRST',
  paper_code: 'PAPER_1',
  part_code: 'UOE_PART_3',
  target_level: EnglishLevel.B2,
};

function makeItem(overrides: Partial<PracticeItem> = {}): PracticeItem {
  return {
    id: 'item-1',
    exercise_id: EXERCISE.id,
    position: 1,
    task_type: 'word_formation',
    prompt: 'Form a word from RESPONSIBLE to fit gap (1).',
    options: null,
    answer_key: { kind: 'text', acceptedAnswers: ['responsibly'], caseSensitive: false },
    explanation: 'RESPONSIBLE is an adjective; the gap needs the adverb RESPONSIBLY.',
    skill_tags: ['word-formation'],
    ...overrides,
  } as unknown as PracticeItem;
}

function wrongTextAnswer(
  value: string,
  overrides: Partial<RecordPracticeMistakesGradedItem> = {},
): RecordPracticeMistakesGradedItem {
  return {
    item: makeItem(),
    payload: { kind: 'text', value } as PracticeAnswerPayload,
    normalizedAnswer: value.toLowerCase(),
    isCorrect: false,
    answerId: 'answer-1',
    ...overrides,
  };
}

interface StoredConcept {
  id: string;
  userId: string;
  conceptKey: string;
  timesWrong: number;
  timesCorrect: number;
  lastUserAnswer: string;
  correctAnswer: string;
  baseWord: string | null;
  explanation: string | null;
  source: MistakeSource;
  skillSlug: string;
}

interface FakeRepoState {
  concepts: StoredConcept[];
  occurrences: Array<Record<string, unknown>>;
  laterCorrectCalls: Array<{ userId: string; conceptKey: string; at: Date }>;
  registerWrongCalls: Array<Record<string, unknown>>;
}

/**
 * In-memory stand-in that mirrors the repository's real contract: the
 * concept is unique per (userId, conceptKey), the occurrence insert is
 * rejected when the same practice answer was already recorded, and
 * registerLaterCorrect only ever updates an existing concept.
 */
function makeFakeRepository(options: { duplicateAnswerIds?: string[] } = {}): {
  repository: MistakesRepositoryPort;
  state: FakeRepoState;
} {
  const state: FakeRepoState = {
    concepts: [],
    occurrences: [],
    laterCorrectCalls: [],
    registerWrongCalls: [],
  };
  const duplicates = new Set(options.duplicateAnswerIds ?? []);

  const repository: MistakesRepositoryPort = {
    async ensureConcept(data) {
      const existing = state.concepts.find(
        (concept) => concept.userId === data.userId && concept.conceptKey === data.conceptKey,
      );
      if (existing !== undefined) return existing.id;
      const created: StoredConcept = {
        id: `concept-${state.concepts.length + 1}`,
        userId: data.userId,
        conceptKey: data.conceptKey,
        timesWrong: 0,
        timesCorrect: 0,
        lastUserAnswer: data.userAnswer,
        correctAnswer: data.correctAnswer,
        baseWord: data.baseWord,
        explanation: data.explanation,
        source: data.source,
        skillSlug: data.skillSlug,
      };
      state.concepts.push(created);
      return created.id;
    },
    async createOccurrence(data) {
      if (data.practiceAnswerId !== null && duplicates.has(data.practiceAnswerId)) return null;
      state.occurrences.push({ ...data });
      return `occurrence-${state.occurrences.length}`;
    },
    async registerWrong(data) {
      state.registerWrongCalls.push({ ...data });
      const concept = state.concepts.find((candidate) => candidate.id === data.conceptId);
      if (concept === undefined) throw new Error('registerWrong on a missing concept');
      concept.timesWrong += 1;
      concept.lastUserAnswer = data.userAnswer;
    },
    async registerLaterCorrect(userId, conceptKey, at) {
      state.laterCorrectCalls.push({ userId, conceptKey, at });
      const concept = state.concepts.find(
        (candidate) => candidate.userId === userId && candidate.conceptKey === conceptKey,
      );
      if (concept === undefined) return false;
      concept.timesCorrect += 1;
      return true;
    },
  };

  return { repository, state };
}

function makeService(options: { duplicateAnswerIds?: string[] } = {}) {
  const { repository, state } = makeFakeRepository(options);
  const service = new RecordPracticeMistakesService({ repository: () => repository });
  return { service, state };
}

const MANAGER = {} as EntityManager;

describe('RecordPracticeMistakesService.record — creating a mistake', () => {
  it('creates one concept and one occurrence for a wrong answer', async () => {
    const { service, state } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('IRRESPONSIBLE')],
    });

    assert.deepEqual(result, { recordedCount: 1, masteredCount: 0, skippedCount: 0 });
    assert.equal(state.concepts.length, 1);
    assert.equal(state.occurrences.length, 1);
    assert.equal(state.concepts[0].conceptKey, 'uoe_part_3|responsible|responsibly');
    assert.equal(state.concepts[0].source, MistakeSource.PRACTICE_ATTEMPT);
    assert.equal(state.concepts[0].skillSlug, 'use-of-english');
    assert.equal(state.concepts[0].baseWord, 'RESPONSIBLE');
    assert.equal(state.concepts[0].timesWrong, 1);
  });

  it('stores both the wrong answer and the correct one', async () => {
    const { service, state } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('IRRESPONSIBLE')],
    });

    assert.equal(state.concepts[0].lastUserAnswer, 'IRRESPONSIBLE');
    assert.equal(state.concepts[0].correctAnswer, 'responsibly');
    assert.equal(state.occurrences[0].userAnswer, 'IRRESPONSIBLE');
    assert.equal(state.occurrences[0].correctAnswer, 'responsibly');
    assert.equal(state.occurrences[0].normalizedAnswer, 'irresponsible');
  });

  it('links every written row to the submitting user and to its practice rows', async () => {
    const { service, state } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('IRRESPONSIBLE')],
    });

    assert.equal(state.concepts[0].userId, USER_ID);
    assert.equal(state.occurrences[0].userId, USER_ID);
    assert.equal(state.occurrences[0].practiceAttemptId, ATTEMPT_ID);
    assert.equal(state.occurrences[0].practiceExerciseId, EXERCISE.id);
    assert.equal(state.occurrences[0].practiceItemId, 'item-1');
    assert.equal(state.occurrences[0].practiceAnswerId, 'answer-1');
    assert.equal(state.occurrences[0].occurredAt, OCCURRED_AT);
  });

  it('records an unanswered item as a mistake, flagged as unanswered', async () => {
    const { service, state } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [
        wrongTextAnswer('unused', {
          payload: { kind: 'unanswered' } as PracticeAnswerPayload,
          normalizedAnswer: null,
        }),
      ],
    });

    assert.equal(state.occurrences.length, 1);
    assert.equal(state.occurrences[0].isUnanswered, true);
    assert.equal(state.concepts[0].lastUserAnswer, '(no answer given)');
  });

  it('resolves a single_choice mistake to its option labels, not raw ids', async () => {
    const { service, state } = makeService();
    const item = makeItem({
      task_type: 'multiple_choice',
      prompt: 'What does the writer suggest?',
      options: [
        { id: 'a', label: 'She regrets it' },
        { id: 'b', label: 'She insists on it' },
      ],
      answer_key: { kind: 'single_choice', acceptedOptionIds: ['b'] },
    });

    await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: { ...EXERCISE, part_code: 'READING_PART_5' },
      occurredAt: OCCURRED_AT,
      items: [
        {
          item,
          payload: { kind: 'single_choice', optionId: 'a' },
          normalizedAnswer: 'a',
          isCorrect: false,
          answerId: 'answer-9',
        },
      ],
    });

    assert.equal(state.concepts[0].lastUserAnswer, 'She regrets it');
    assert.equal(state.concepts[0].correctAnswer, 'She insists on it');
    assert.equal(state.concepts[0].skillSlug, 'reading');
    // Reading questions are keyed by the item, never by the option label.
    assert.equal(state.concepts[0].conceptKey, 'reading_part_5|item|item-1');
  });
});

describe('RecordPracticeMistakesService.record — correct answers', () => {
  it('never creates a concept or an occurrence for a correct answer', async () => {
    const { service, state } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('responsibly', { isCorrect: true })],
    });

    assert.deepEqual(result, { recordedCount: 0, masteredCount: 0, skippedCount: 0 });
    assert.equal(state.concepts.length, 0);
    assert.equal(state.occurrences.length, 0);
    assert.equal(state.laterCorrectCalls.length, 1);
  });

  it('counts a later correct answer on a concept the user had already failed', async () => {
    const { service, state } = makeService();
    const input = {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
    };

    await service.record(MANAGER, { ...input, items: [wrongTextAnswer('IRRESPONSIBLE')] });
    const result = await service.record(MANAGER, {
      ...input,
      items: [wrongTextAnswer('responsibly', { isCorrect: true, answerId: 'answer-2' })],
    });

    assert.deepEqual(result, { recordedCount: 0, masteredCount: 1, skippedCount: 0 });
    assert.equal(state.concepts.length, 1);
    assert.equal(state.concepts[0].timesCorrect, 1);
    assert.equal(state.concepts[0].timesWrong, 1);
    assert.equal(state.occurrences.length, 1);
  });

  it('does not leak a correct answer onto another user’s concept', async () => {
    const { service, state } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('IRRESPONSIBLE')],
    });
    await service.record(MANAGER, {
      userId: OTHER_USER_ID,
      attemptId: 'attempt-2',
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('responsibly', { isCorrect: true, answerId: 'answer-3' })],
    });

    assert.equal(state.concepts.length, 1);
    assert.equal(state.concepts[0].timesCorrect, 0);
    assert.equal(state.laterCorrectCalls[0].userId, OTHER_USER_ID);
  });
});

describe('RecordPracticeMistakesService.record — deduplication', () => {
  it('aggregates the same concept failed again instead of duplicating it', async () => {
    const { service, state } = makeService();
    const input = {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
    };

    await service.record(MANAGER, { ...input, items: [wrongTextAnswer('IRRESPONSIBLE')] });
    await service.record(MANAGER, {
      ...input,
      attemptId: 'attempt-2',
      items: [
        wrongTextAnswer('RESPONSIBLENESS', {
          answerId: 'answer-2',
          item: makeItem({ id: 'item-77' }),
        }),
      ],
    });

    assert.equal(state.concepts.length, 1);
    assert.equal(state.concepts[0].timesWrong, 2);
    assert.equal(state.concepts[0].lastUserAnswer, 'RESPONSIBLENESS');
    // Both attempts stay individually auditable.
    assert.equal(state.occurrences.length, 2);
  });

  it('does not double count when the same graded answer is recorded twice', async () => {
    const { service, state } = makeService({ duplicateAnswerIds: ['answer-1'] });

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [wrongTextAnswer('IRRESPONSIBLE')],
    });

    assert.equal(result.recordedCount, 0);
    assert.equal(state.registerWrongCalls.length, 0);
    assert.equal(state.concepts[0].timesWrong, 0);
  });
});

describe('RecordPracticeMistakesService.record — incomplete data', () => {
  it('skips an item whose answer key has no accepted answer instead of writing an empty mistake', async () => {
    const { service, state } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [
        wrongTextAnswer('IRRESPONSIBLE', {
          item: makeItem({
            answer_key: { kind: 'text', acceptedAnswers: [], caseSensitive: false },
          }),
        }),
      ],
    });

    assert.deepEqual(result, { recordedCount: 0, masteredCount: 0, skippedCount: 1 });
    assert.equal(state.concepts.length, 0);
    assert.equal(state.occurrences.length, 0);
  });

  it('accepts an item with no explanation, no base word and no persisted answer id', async () => {
    const { service, state } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: { ...EXERCISE, part_code: 'UOE_PART_2', target_level: null },
      occurredAt: OCCURRED_AT,
      items: [
        wrongTextAnswer('for', {
          answerId: null,
          item: makeItem({
            task_type: 'open_cloze',
            prompt: 'Write one word for gap (1).',
            explanation: null,
            answer_key: { kind: 'text', acceptedAnswers: ['been'], caseSensitive: false },
          }),
        }),
      ],
    });

    assert.equal(result.recordedCount, 1);
    assert.equal(state.concepts[0].baseWord, null);
    assert.equal(state.concepts[0].explanation, null);
    assert.equal(state.concepts[0].conceptKey, 'uoe_part_2|na|been');
    assert.equal(state.occurrences[0].practiceAnswerId, null);
  });

  it('records nothing at all for an empty item list', async () => {
    const { service, state } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      attemptId: ATTEMPT_ID,
      exercise: EXERCISE,
      occurredAt: OCCURRED_AT,
      items: [],
    });

    assert.deepEqual(result, { recordedCount: 0, masteredCount: 0, skippedCount: 0 });
    assert.equal(state.concepts.length, 0);
    assert.equal(state.occurrences.length, 0);
  });
});
