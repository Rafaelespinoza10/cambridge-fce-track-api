import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GenerateMistakePracticeExerciseService,
} from './generate-mistake-practice-exercise.service';
import type {
  MistakesRepositoryPort,
  GenerateMistakePracticeExerciseServiceDeps,
} from './generate-mistake-practice-exercise.service';
import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
} from '@lib/practice/generate-practice-exercise-core';
import type {
  LLMServicePort,
  PracticeExercisesRepositoryPort,
} from '@lib/practice/generate-practice-exercise-core';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import type { GenerateMistakePracticeRequest } from '../../interfaces/practice/practice-mistake-generation.interface';
import { MistakeErrorSubtype, MistakeErrorType } from '@models/enums';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type {
  CreateExerciseData,
  CreateItemData,
} from '@repositories/practice/practice-exercises.repository';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { DataSource } from 'typeorm';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const IDEMPOTENCY_KEY = 'aaaaaaaa-1111-1111-1111-111111111111';

function concept(overrides: Partial<MistakeConcept> = {}): MistakeConcept {
  return {
    id: overrides.id ?? 'concept-1',
    task_type: 'word_formation',
    base_word: 'RESPONSIBLE',
    correct_answer: 'responsibly',
    error_type: MistakeErrorType.WORD_CLASS,
    error_subtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    times_wrong: 3,
    last_wrong_at: new Date('2026-08-20T00:00:00Z'),
    ...overrides,
  } as MistakeConcept;
}

function wordFormationItem(position: number) {
  return {
    position,
    prompt: `Form a word from CAREFUL to fit gap (${position}).`,
    options: null,
    answerKey: { kind: 'text', acceptedAnswers: ['carefully'], caseSensitive: false },
    explanation: 'Adjective to adverb.',
    skillTags: ['word-formation'],
  };
}

function validWordFormationResponse(itemCount: number) {
  return {
    title: 'Practice My Mistakes - Word Formation',
    instructions: 'Form a word that fits each gap.',
    stimulus: Array.from({ length: itemCount }, (_, i) => `(${i + 1})`).join(' '),
    items: Array.from({ length: itemCount }, (_, i) => wordFormationItem(i + 1)),
  };
}

const SAFE_RESULT: PracticeExerciseSafeWithItems = {
  exercise: {
    id: 'exercise-id',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    targetLevel: 'B2' as never,
    title: 't',
    instructions: 'i',
    stimulus: null,
    timeLimitSeconds: null,
    itemCount: 8,
    createdAt: new Date(),
  },
  items: [],
};

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: never) => Promise<T>) => work({} as never),
} as unknown as DataSource;

interface RepoCalls {
  createExercise: CreateExerciseData[];
  createItems: { exerciseId: string; items: CreateItemData[] }[];
  findByIdempotencyKeyForUser: { userId: string; idempotencyKey: string }[];
}

interface MakeServiceOverrides {
  findByIdsForUser?: (userId: string, ids: string[]) => Promise<MistakeConcept[]>;
  findTopWeaknessesForUser?: (userId: string, limit: number) => Promise<MistakeConcept[]>;
  findByIdempotencyKeyForUser?: (
    userId: string,
    idempotencyKey: string,
  ) => Promise<PracticeExercise | null>;
}

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
  overrides: MakeServiceOverrides = {},
): {
  service: GenerateMistakePracticeExerciseService;
  calls: RepoCalls;
  llmMessages: LLMChatMessage[][];
  llmCallCount: () => number;
} {
  const calls: RepoCalls = { createExercise: [], createItems: [], findByIdempotencyKeyForUser: [] };
  const llmMessages: LLMChatMessage[][] = [];
  let llmCalls = 0;
  const llm: LLMServicePort = {
    completeStructured: async (messages, options) => {
      llmCalls += 1;
      llmMessages.push(messages);
      return completeStructured(messages, options);
    },
  };
  const practiceExercises = (): PracticeExercisesRepositoryPort => ({
    createExercise: async (data) => {
      calls.createExercise.push(data as CreateExerciseData);
      return { id: 'exercise-id' } as PracticeExercise;
    },
    createItems: async (exerciseId, items) => {
      calls.createItems.push({ exerciseId, items: items as CreateItemData[] });
      return [];
    },
    findSafeExerciseWithItemsForUser: async () => SAFE_RESULT,
    findByIdempotencyKeyForUser: async (userId, idempotencyKey) => {
      calls.findByIdempotencyKeyForUser.push({ userId, idempotencyKey });
      if (overrides.findByIdempotencyKeyForUser) {
        return overrides.findByIdempotencyKeyForUser(userId, idempotencyKey);
      }
      return null;
    },
  });
  const mistakes = (): MistakesRepositoryPort => ({
    findByIdsForUser: overrides.findByIdsForUser ?? (async () => []),
    findTopWeaknessesForUser: overrides.findTopWeaknessesForUser ?? (async () => []),
  });

  const deps: GenerateMistakePracticeExerciseServiceDeps = {
    llm,
    providerLabel: 'openai',
    modelLabel: 'gpt-4o-mini',
    practiceExercises,
    mistakes,
  };
  const service = new GenerateMistakePracticeExerciseService(FAKE_DATA_SOURCE, deps);
  return { service, calls, llmMessages, llmCallCount: () => llmCalls };
}

function assertGenErr(err: unknown, code: GeneratePracticeExerciseErrorCode): true {
  assert.ok(err instanceof GeneratePracticeExerciseError);
  assert.equal(err.code, code);
  return true;
}

function conceptsRequest(ids: string[], questionCount?: number): GenerateMistakePracticeRequest {
  return { mistakeConceptIds: ids, questionCount, idempotencyKey: IDEMPOTENCY_KEY };
}

function weaknessesRequest(questionCount?: number): GenerateMistakePracticeRequest {
  return { mode: 'weaknesses', questionCount, idempotencyKey: IDEMPOTENCY_KEY };
}

// ── "Practice this mistake" (explicit concept ids) ──────────────────────────

describe('GenerateMistakePracticeExerciseService.execute — concepts mode', () => {
  it('generates from a single mistake concept and tags the exercise + every item with mistake_practice metadata', async () => {
    const target = concept();
    const { service, calls } = makeService(async () => validWordFormationResponse(8), {
      findByIdsForUser: async () => [target],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest([target.id]));

    const exerciseData = calls.createExercise[0]!;
    assert.equal(exerciseData.partCode, 'UOE_PART_3');
    assert.equal(exerciseData.itemCount, 8);
    assert.deepEqual(exerciseData.generationMetadata?.generationSource, 'mistake_practice');
    assert.deepEqual(exerciseData.generationMetadata?.mistakeConceptIds, [target.id]);
    assert.deepEqual(exerciseData.generationMetadata?.targetErrorTypes, [MistakeErrorType.WORD_CLASS]);
    assert.deepEqual(exerciseData.generationMetadata?.targetErrorSubtypes, [
      MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    ]);

    const items = calls.createItems[0]!.items;
    assert.equal(items.length, 8);
    for (const item of items) {
      const metadata = item.metadata as Record<string, unknown>;
      assert.equal(metadata.generationSource, 'mistake_practice');
      assert.equal(metadata.targetConceptId, target.id);
      assert.ok(metadata.practiceMode === 'concept_specific' || metadata.practiceMode === 'pattern_transfer');
    }
    // 8 questions, known subtype -> 2 concept-specific, 6 pattern-transfer (see buildSlotPlan).
    const conceptSpecific = items.filter((i) => (i.metadata as Record<string, unknown>).practiceMode === 'concept_specific');
    const patternTransfer = items.filter((i) => (i.metadata as Record<string, unknown>).practiceMode === 'pattern_transfer');
    assert.equal(conceptSpecific.length, 2);
    assert.equal(patternTransfer.length, 6);
  });

  it('never repeats the exact original sentence — the prompt names the target pattern, not a fixed sentence to copy', async () => {
    const target = concept();
    const { service, llmMessages } = makeService(async () => validWordFormationResponse(8), {
      findByIdsForUser: async () => [target],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest([target.id]));

    const userMessage = llmMessages[0]!.find((m) => m.role === 'user')!.content;
    assert.match(userMessage, /Do not reuse the original sentence\./);
    assert.match(userMessage, /adjective_to_adverb/);
    assert.match(userMessage, /base word "RESPONSIBLE"/);
  });

  it('rejects a user practicing a mistake that is not theirs (findByIdsForUser returns nothing)', async () => {
    const { service } = makeService(async () => validWordFormationResponse(8), {
      findByIdsForUser: async () => [],
    });

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest(['not-mine'])),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES),
    );
  });

  it('rejects an empty mistakeConceptIds array without calling the LLM', async () => {
    const { service, llmCallCount } = makeService(async () => validWordFormationResponse(8));

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest([])),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.INVALID_INPUT),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('picks the dominant taskType when the given concepts span more than one, dropping the rest', async () => {
    const wordFormationConcept = concept({ id: 'wf', task_type: 'word_formation', times_wrong: 5 });
    const openClozeConcept = concept({ id: 'oc', task_type: 'open_cloze', times_wrong: 1 });
    const { service, calls } = makeService(async () => validWordFormationResponse(8), {
      findByIdsForUser: async () => [wordFormationConcept, openClozeConcept],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest(['wf', 'oc']));

    assert.equal(calls.createExercise[0]!.partCode, 'UOE_PART_3');
    assert.deepEqual(calls.createExercise[0]!.generationMetadata?.mistakeConceptIds, ['wf']);
  });
});

// ── "Practice my weaknesses" (auto-selected) ────────────────────────────────

describe('GenerateMistakePracticeExerciseService.execute — weaknesses mode', () => {
  it('generates from multiple weaknesses, using the highest-priority ones for concept-specific slots', async () => {
    const weak1 = concept({ id: 'w1', times_wrong: 9, base_word: 'RESPONSIBLE', correct_answer: 'responsibly' });
    const weak2 = concept({
      id: 'w2',
      times_wrong: 5,
      base_word: 'CARE',
      correct_answer: 'careful',
      error_subtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE,
    });
    const { service, calls } = makeService(async () => validWordFormationResponse(8), {
      findTopWeaknessesForUser: async () => [weak1, weak2],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, weaknessesRequest());

    assert.deepEqual(
      new Set(calls.createExercise[0]!.generationMetadata?.mistakeConceptIds),
      new Set(['w1', 'w2']),
    );
  });

  it('returns NO_ELIGIBLE_MISTAKES when the user has zero recorded mistakes', async () => {
    const { service, llmCallCount } = makeService(async () => validWordFormationResponse(8), {
      findTopWeaknessesForUser: async () => [],
    });

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, weaknessesRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('falls back to 100% concept-specific when every candidate is still unclassified (unknown)', async () => {
    const unclassified = concept({ error_type: MistakeErrorType.UNKNOWN, error_subtype: null });
    const { service, calls } = makeService(async () => validWordFormationResponse(8), {
      findTopWeaknessesForUser: async () => [unclassified],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, weaknessesRequest());

    const items = calls.createItems[0]!.items;
    assert.ok(items.every((i) => (i.metadata as Record<string, unknown>).practiceMode === 'concept_specific'));
  });
});

// ── questionCount ────────────────────────────────────────────────────────────

describe('GenerateMistakePracticeExerciseService.execute — questionCount', () => {
  for (const count of [5, 8, 10, 15, 20]) {
    it(`accepts questionCount=${count}`, async () => {
      const { service, calls } = makeService(async () => validWordFormationResponse(count), {
        findByIdsForUser: async () => [concept()],
      });
      await service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest(['concept-1'], count));
      assert.equal(calls.createExercise[0]!.itemCount, count);
    });
  }

  it('rejects an unsupported questionCount without calling the LLM', async () => {
    const { service, llmCallCount } = makeService(async () => validWordFormationResponse(6), {
      findByIdsForUser: async () => [concept()],
    });

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest(['concept-1'], 6)),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.INVALID_INPUT),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('defaults to 8 when questionCount is omitted', async () => {
    const { service, calls } = makeService(async () => validWordFormationResponse(8), {
      findByIdsForUser: async () => [concept()],
    });
    await service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest(['concept-1']));
    assert.equal(calls.createExercise[0]!.itemCount, 8);
  });
});

// ── idempotency ──────────────────────────────────────────────────────────────

describe('GenerateMistakePracticeExerciseService.execute — idempotency', () => {
  it('replays the persisted exercise for the same user + same key, without calling the LLM', async () => {
    const { service, llmCallCount } = makeService(async () => validWordFormationResponse(8), {
      findByIdsForUser: async () => [concept()],
      findByIdempotencyKeyForUser: async () => ({ id: 'exercise-id' }) as PracticeExercise,
    });

    const result = await service.execute(USER_ID, IDEMPOTENCY_KEY, conceptsRequest(['concept-1']));

    assert.equal(llmCallCount(), 0);
    assert.equal(result.exercise.id, SAFE_RESULT.exercise.id);
  });
});
