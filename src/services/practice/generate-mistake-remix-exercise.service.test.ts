import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { GenerateMistakeRemixExerciseService } from './generate-mistake-remix-exercise.service';
import type {
  MistakesRepositoryPort,
  GenerateMistakeRemixExerciseServiceDeps,
} from './generate-mistake-remix-exercise.service';
import {
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
} from '@lib/practice/generate-practice-exercise-core';
import type {
  LLMServicePort,
  PracticeExercisesRepositoryPort,
} from '@lib/practice/generate-practice-exercise-core';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import type { GenerateMistakeRemixRequest } from '../../interfaces/practice/practice-mistake-remix.interface';
import { MasteryStatus } from '@lib/mistakes/mastery-score';
import { MistakeErrorSubtype, MistakeErrorType } from '@models/enums';
import type { WeaknessDto } from '../../interfaces/mistakes/weaknesses.interface';
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
const PART_CODE = 'UOE_PART_3';

function weakness(overrides: Partial<WeaknessDto> = {}): WeaknessDto {
  return {
    skill: 'use-of-english',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: PART_CODE,
    errorType: MistakeErrorType.WORD_CLASS,
    errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    masteryScore: 35,
    status: MasteryStatus.WEAK,
    timesWrong: 5,
    conceptCount: 1,
    remediationAttempts: 0,
    remediationCorrect: 0,
    distinctBaseWords: 0,
    distinctPracticeDays: 0,
    firstSeenAt: new Date('2026-07-01T00:00:00Z'),
    lastWrongAt: new Date('2026-08-01T00:00:00Z'),
    lastPracticedAt: null,
    masteredBlocked: false,
    ...overrides,
  };
}

function concept(overrides: Partial<MistakeConcept> = {}): MistakeConcept {
  return {
    id: 'concept-1',
    part_code: PART_CODE,
    task_type: 'word_formation',
    base_word: 'RESPONSIBLE',
    correct_answer: 'responsibly',
    error_type: MistakeErrorType.WORD_CLASS,
    error_subtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
    times_wrong: 5,
    last_wrong_at: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as MistakeConcept;
}

function remixItem(position: number) {
  return {
    position,
    prompt: `Form a word from CAREFUL to fit gap (${position}).`,
    options: null,
    answerKey: { kind: 'text', acceptedAnswers: ['carefully'], caseSensitive: false },
    explanation: 'Adjective to adverb.',
    skillTags: ['word-formation'],
  };
}

function validRemixResponse(itemCount: number) {
  return {
    title: 'Mistake Remix',
    instructions: 'Form a word that fits each gap.',
    stimulus: Array.from({ length: itemCount }, (_, i) => `(${i + 1})`).join(' '),
    items: Array.from({ length: itemCount }, (_, i) => remixItem(i + 1)),
  };
}

const SAFE_RESULT: PracticeExerciseSafeWithItems = {
  exercise: {
    id: 'exercise-id',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: PART_CODE,
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
  weaknessProfiles?: (userId: string) => Promise<WeaknessDto[]>;
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
  service: GenerateMistakeRemixExerciseService;
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
    findTopWeaknessesForUser: overrides.findTopWeaknessesForUser ?? (async () => []),
  });

  const deps: GenerateMistakeRemixExerciseServiceDeps = {
    llm,
    providerLabel: 'openai',
    modelLabel: 'gpt-4o-mini',
    practiceExercises,
    mistakes,
    weaknessProfiles: overrides.weaknessProfiles ?? (async () => []),
  };
  const service = new GenerateMistakeRemixExerciseService(FAKE_DATA_SOURCE, deps);
  return { service, calls, llmMessages, llmCallCount: () => llmCalls };
}

function assertGenErr(err: unknown, code: GeneratePracticeExerciseErrorCode): true {
  assert.ok(err instanceof GeneratePracticeExerciseError);
  assert.equal(err.code, code);
  return true;
}

function request(questionCount?: number): GenerateMistakeRemixRequest {
  return { questionCount, idempotencyKey: IDEMPOTENCY_KEY };
}

// ── happy path ───────────────────────────────────────────────────────────────

describe('GenerateMistakeRemixExerciseService.execute — happy path', () => {
  it('generates a Quick (8-question) remix and tags the exercise + every item with mistake_remix metadata', async () => {
    const w1 = weakness({ masteryScore: 35, errorSubtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB });
    const w2 = weakness({ masteryScore: 48, errorSubtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE });
    const c1 = concept({ id: 'c1', error_subtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB, base_word: 'RESPONSIBLE' });
    const c2 = concept({ id: 'c2', error_subtype: MistakeErrorSubtype.NOUN_TO_ADJECTIVE, base_word: 'ENCOURAGE' });
    const { service, calls } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [w1, w2],
      findTopWeaknessesForUser: async () => [c1, c2],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, request());

    // Two weaknesses, cap 2 each -> at most 4 targeted slots are actually
    // fillable even though computeTargetedCount(8) asks for 5; the shortfall
    // becomes extra neutral (see buildRemixPlan's own fallback behavior).
    const exerciseData = calls.createExercise[0]!;
    assert.equal(exerciseData.partCode, PART_CODE);
    assert.equal(exerciseData.itemCount, 8);
    assert.equal(exerciseData.generationMetadata?.generationSource, 'mistake_remix');
    assert.equal(exerciseData.generationMetadata?.remixNeutralCount, 4);
    assert.equal(
      exerciseData.generationMetadata?.remixTargetPatterns?.reduce((s, p) => s + p.questionCount, 0),
      4,
    );

    const items = calls.createItems[0]!.items;
    assert.equal(items.length, 8);
    const targeted = items.filter((i) => (i.metadata as Record<string, unknown>).questionRole === 'targeted');
    const neutral = items.filter((i) => (i.metadata as Record<string, unknown>).questionRole === 'neutral');
    assert.equal(targeted.length, 4);
    assert.equal(neutral.length, 4);
    for (const item of neutral) {
      const metadata = item.metadata as Record<string, unknown>;
      assert.equal(metadata.targetErrorType, null);
      assert.equal(metadata.targetErrorSubtype, null);
    }
    for (const item of targeted) {
      const metadata = item.metadata as Record<string, unknown>;
      assert.equal(metadata.generationSource, 'mistake_remix');
      assert.ok(metadata.targetErrorType);
    }
  });

  it('supports the Challenge (15-question) size', async () => {
    const w1 = weakness();
    const c1 = concept();
    const { service, calls } = makeService(async () => validRemixResponse(15), {
      weaknessProfiles: async () => [w1],
      findTopWeaknessesForUser: async () => [c1],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, request(15));

    assert.equal(calls.createExercise[0]!.itemCount, 15);
  });

  it('rejects an unsupported questionCount without calling the LLM', async () => {
    const { service, llmCallCount } = makeService(async () => validRemixResponse(10), {
      weaknessProfiles: async () => [weakness()],
      findTopWeaknessesForUser: async () => [concept()],
    });

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, request(10)),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.INVALID_INPUT),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('defaults to 8 when questionCount is omitted', async () => {
    const { service, calls } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [weakness()],
      findTopWeaknessesForUser: async () => [concept()],
    });
    await service.execute(USER_ID, IDEMPOTENCY_KEY, request());
    assert.equal(calls.createExercise[0]!.itemCount, 8);
  });
});

// ── empty states ─────────────────────────────────────────────────────────────

describe('GenerateMistakeRemixExerciseService.execute — no eligible weaknesses', () => {
  it('rejects with NO_ELIGIBLE_MISTAKES when the user has zero weaknesses', async () => {
    const { service, llmCallCount } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [],
    });

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, request()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('rejects with NO_ELIGIBLE_MISTAKES when every weakness is outside the v1-supported part', async () => {
    const { service, llmCallCount } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [weakness({ partCode: 'UOE_PART_1' })],
    });

    await assert.rejects(
      () => service.execute(USER_ID, IDEMPOTENCY_KEY, request()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.NO_ELIGIBLE_MISTAKES),
    );
    assert.equal(llmCallCount(), 0);
  });

  it('still generates (all-neutral) when a single weakness has no concept example available', async () => {
    const { service, calls } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [weakness()],
      findTopWeaknessesForUser: async () => [],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, request());

    const items = calls.createItems[0]!.items;
    assert.ok(items.every((i) => (i.metadata as Record<string, unknown>).questionRole === 'neutral'));
  });
});

// ── prompt content ───────────────────────────────────────────────────────────

describe('GenerateMistakeRemixExerciseService.execute — prompt', () => {
  it('never reveals which items are targeted vs neutral to the student (blind practice) — only the safe DTO is returned', async () => {
    const { service } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [weakness()],
      findTopWeaknessesForUser: async () => [concept()],
    });

    const result = await service.execute(USER_ID, IDEMPOTENCY_KEY, request());

    assert.equal(JSON.stringify(result).includes('questionRole'), false);
    assert.equal(JSON.stringify(result).includes('targetErrorType'), false);
  });

  it('sends the mixed-session and diversity instructions to the model', async () => {
    const { service, llmMessages } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [weakness()],
      findTopWeaknessesForUser: async () => [concept()],
    });

    await service.execute(USER_ID, IDEMPOTENCY_KEY, request());

    const userMessage = llmMessages[0]!.find((m) => m.role === 'user')!.content;
    assert.match(userMessage, /MIXED adaptive session/);
    assert.match(userMessage, /do not hint/);
  });
});

// ── idempotency ──────────────────────────────────────────────────────────────

describe('GenerateMistakeRemixExerciseService.execute — idempotency', () => {
  it('replays the persisted exercise for the same user + same key, without calling the LLM', async () => {
    const { service, llmCallCount } = makeService(async () => validRemixResponse(8), {
      weaknessProfiles: async () => [weakness()],
      findTopWeaknessesForUser: async () => [concept()],
      findByIdempotencyKeyForUser: async () => ({ id: 'exercise-id' }) as PracticeExercise,
    });

    const result = await service.execute(USER_ID, IDEMPOTENCY_KEY, request());

    assert.equal(llmCallCount(), 0);
    assert.equal(result.exercise.id, SAFE_RESULT.exercise.id);
  });
});
