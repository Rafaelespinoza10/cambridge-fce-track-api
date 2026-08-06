import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GeneratePracticeExerciseService,
  GeneratePracticeExerciseError,
  GeneratePracticeExerciseErrorCode,
} from './generate-practice-exercise.service';
import type {
  LLMServicePort,
  PracticeExercisesRepositoryPort,
} from './generate-practice-exercise.service';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import type { GeneratePracticeExerciseRequest } from '../../interfaces/practice/practice-exercise.interface';
import type { PracticeExerciseSafeWithItems } from '../../interfaces/practice/practice-exercise.interface';
import type { DataSource } from 'typeorm';
import type {
  CreateExerciseData,
  CreateItemData,
} from '../../repositories/practice-exercises.repository';
import type { PracticeExercise } from '../../models/PracticeExercise';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function multipleChoiceClozeRequest(): GeneratePracticeExerciseRequest {
  return {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    taskType: 'multiple_choice_cloze',
  };
}

function openClozeRequest(): GeneratePracticeExerciseRequest {
  return {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_2',
    taskType: 'open_cloze',
  };
}

function wordFormationRequest(): GeneratePracticeExerciseRequest {
  return {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_3',
    taskType: 'word_formation',
  };
}

function keyWordTransformationRequest(): GeneratePracticeExerciseRequest {
  return {
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_4',
    taskType: 'key_word_transformation',
  };
}

function mcqItem(position: number) {
  return {
    position,
    prompt: `Choose the best option for gap (${position}).`,
    options: [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
      { id: 'c', label: 'gamma' },
      { id: 'd', label: 'delta' },
    ],
    answerKey: { kind: 'single_choice', acceptedOptionIds: ['a'] },
    explanation: 'Alpha is the only option that fits the collocation.',
    skillTags: ['collocations'],
  };
}

function textItem(position: number) {
  return {
    position,
    prompt: `Complete gap (${position}) with one word.`,
    options: null,
    answerKey: { kind: 'text', acceptedAnswers: ['about'], caseSensitive: false },
    explanation: 'A preposition is needed here.',
    skillTags: ['prepositions'],
  };
}

function validMultipleChoiceClozeResponse() {
  return {
    title: 'Use of English - Part 1',
    instructions: 'Choose the correct word for each gap.',
    stimulus: 'A long passage with (1) (2) (3) (4) (5) (6) (7) (8) gaps.',
    items: Array.from({ length: 8 }, (_, i) => mcqItem(i + 1)),
  };
}

function validOpenClozeResponse() {
  return {
    title: 'Use of English - Part 2',
    instructions: 'Fill each gap with one word.',
    stimulus: 'A long passage with (1) (2) (3) (4) (5) (6) (7) (8) gaps.',
    items: Array.from({ length: 8 }, (_, i) => textItem(i + 1)),
  };
}

function validWordFormationResponse() {
  return {
    title: 'Use of English - Part 3',
    instructions: 'Form a word that fits each gap.',
    stimulus: 'A long passage with (1) (2) (3) (4) (5) (6) (7) (8) gaps.',
    items: Array.from({ length: 8 }, (_, i) => textItem(i + 1)),
  };
}

function validKeyWordTransformationResponse() {
  return {
    title: 'Use of English - Part 4',
    instructions: 'Complete the second sentence so it means the same as the first.',
    stimulus: null,
    items: Array.from({ length: 6 }, (_, i) => ({
      position: i + 1,
      prompt: 'She last visited Paris three years ago.\nBEEN\nShe ______ Paris for three years.',
      options: null,
      answerKey: { kind: 'text', acceptedAnswers: ["hasn't been to"], caseSensitive: false },
      explanation: 'Present perfect with "since/for" duration.',
      skillTags: ['present-perfect'],
    })),
  };
}

const SAFE_RESULT: PracticeExerciseSafeWithItems = {
  exercise: {
    id: 'exercise-id',
    examCode: 'B2_FIRST',
    paperCode: 'PAPER_1',
    partCode: 'UOE_PART_1',
    targetLevel: null,
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
}

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
  findSafeExerciseWithItemsForUser: () => Promise<PracticeExerciseSafeWithItems | null> = async () =>
    SAFE_RESULT,
): { service: GeneratePracticeExerciseService; calls: RepoCalls } {
  const calls: RepoCalls = { createExercise: [], createItems: [] };
  const llm: LLMServicePort = { completeStructured };
  const practiceExercises = (): PracticeExercisesRepositoryPort => ({
    createExercise: async (data) => {
      calls.createExercise.push(data);
      return { id: 'exercise-id' } as PracticeExercise;
    },
    createItems: async (exerciseId, items) => {
      calls.createItems.push({ exerciseId, items });
      return [];
    },
    findSafeExerciseWithItemsForUser,
  });
  const service = new GeneratePracticeExerciseService(FAKE_DATA_SOURCE, {
    llm,
    providerLabel: 'openai',
    modelLabel: 'gpt-4o-mini',
    practiceExercises,
  });
  return { service, calls };
}

function assertGenErr(err: unknown, code: GeneratePracticeExerciseErrorCode): true {
  assert.ok(err instanceof GeneratePracticeExerciseError);
  assert.equal(err.code, code);
  return true;
}

// ── happy path ───────────────────────────────────────────────────────────────

describe('GeneratePracticeExerciseService.execute — happy path', () => {
  it('generates and persists a multiple_choice_cloze exercise', async () => {
    const { service, calls } = makeService(async () => validMultipleChoiceClozeResponse());
    await service.execute(USER_ID, multipleChoiceClozeRequest());

    assert.equal(calls.createExercise.length, 1);
    assert.equal(calls.createExercise[0]?.userId, USER_ID);
    assert.equal(calls.createExercise[0]?.examCode, 'B2_FIRST');
    assert.equal(calls.createExercise[0]?.paperCode, 'PAPER_1');
    assert.equal(calls.createExercise[0]?.partCode, 'UOE_PART_1');
    assert.equal(calls.createExercise[0]?.targetLevel, 'B2');
    assert.equal(calls.createExercise[0]?.itemCount, 8);
    assert.equal(calls.createExercise[0]?.timeLimitSeconds, 15 * 60);
    assert.equal(calls.createItems[0]?.items.length, 8);
  });

  it('generates and persists an open_cloze exercise', async () => {
    const { service, calls } = makeService(async () => validOpenClozeResponse());
    await service.execute(USER_ID, openClozeRequest());
    assert.equal(calls.createItems[0]?.items.length, 8);
    assert.equal(calls.createItems[0]?.items[0]?.options, null);
  });

  it('generates and persists a word_formation exercise', async () => {
    const { service, calls } = makeService(async () => validWordFormationResponse());
    await service.execute(USER_ID, wordFormationRequest());
    assert.equal(calls.createItems[0]?.items.length, 8);
  });

  it('generates and persists a key_word_transformation exercise (null stimulus, 6 items)', async () => {
    const { service, calls } = makeService(async () => validKeyWordTransformationResponse());
    await service.execute(USER_ID, keyWordTransformationRequest());
    assert.equal(calls.createExercise[0]?.stimulus, null);
    assert.equal(calls.createExercise[0]?.itemCount, 6);
  });

  it('sends a system prompt and a JSON Schema Structured Outputs request', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    let capturedOptions: LLMStructuredCompletionOptions | undefined;
    const { service } = makeService(async (messages, options) => {
      capturedMessages = messages;
      capturedOptions = options;
      return validMultipleChoiceClozeResponse();
    });

    await service.execute(USER_ID, multipleChoiceClozeRequest());

    assert.equal(capturedMessages?.[0]?.role, 'system');
    assert.equal(capturedMessages?.[1]?.role, 'user');
    assert.match(capturedMessages?.[1]?.content ?? '', /Part 1 - Multiple Choice Cloze/);
    assert.match(capturedMessages?.[1]?.content ?? '', /Number of items: 8/);
    assert.match(capturedMessages?.[1]?.content ?? '', /Target CEFR level: B2/);
    assert.equal(capturedOptions?.responseSchema.name, 'practice_exercise');
    assert.equal(capturedOptions?.responseSchema.strict, true);
    assert.ok((capturedOptions?.timeoutMs ?? 0) > 0);
  });

  it('defaults targetLevel to B2 when omitted, and forwards an explicit override', async () => {
    const { service, calls } = makeService(async () => validMultipleChoiceClozeResponse());
    await service.execute(USER_ID, {
      ...multipleChoiceClozeRequest(),
      targetLevel: 'B1_PLUS' as never,
    });
    assert.equal(calls.createExercise[0]?.targetLevel, 'B1_PLUS');
  });
});

// ── request validation ──────────────────────────────────────────────────────

describe('GeneratePracticeExerciseService.execute — request validation', () => {
  it('rejects a taskType with no generation support', async () => {
    const { service, calls } = makeService(async () => validMultipleChoiceClozeResponse());

    await assert.rejects(
      () =>
        service.execute(USER_ID, {
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'READING_PART_5',
          taskType: 'multiple_choice',
        }),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.INVALID_INPUT),
    );
    assert.equal(calls.createExercise.length, 0);
  });

  it('rejects a taskType/partCode mismatch', async () => {
    const { service } = makeService(async () => validMultipleChoiceClozeResponse());

    await assert.rejects(
      () =>
        service.execute(USER_ID, {
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'UOE_PART_2',
          taskType: 'multiple_choice_cloze',
        }),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an invalid targetLevel', async () => {
    const { service } = makeService(async () => validMultipleChoiceClozeResponse());

    await assert.rejects(
      () =>
        service.execute(USER_ID, {
          ...multipleChoiceClozeRequest(),
          targetLevel: 'not_a_level' as never,
        }),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.INVALID_INPUT),
    );
  });
});

// ── response validation ─────────────────────────────────────────────────────

describe('GeneratePracticeExerciseService.execute — response validation', () => {
  it('rejects a wrong item count', async () => {
    const { service } = makeService(async () => ({
      ...validMultipleChoiceClozeResponse(),
      items: Array.from({ length: 7 }, (_, i) => mcqItem(i + 1)),
    }));

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects duplicate/gapped positions', async () => {
    const items = Array.from({ length: 8 }, (_, i) => mcqItem(i + 1));
    items[7] = { ...(items[6] as ReturnType<typeof mcqItem>) };
    const { service } = makeService(async () => ({ ...validMultipleChoiceClozeResponse(), items }));

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a multiple_choice_cloze item missing options', async () => {
    const items = Array.from({ length: 8 }, (_, i) => mcqItem(i + 1));
    items[0] = { ...(items[0] as ReturnType<typeof mcqItem>), options: null as never };
    const { service } = makeService(async () => ({ ...validMultipleChoiceClozeResponse(), items }));

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a multiple_choice_cloze item with the wrong number of options', async () => {
    const items = Array.from({ length: 8 }, (_, i) => mcqItem(i + 1));
    items[0] = { ...(items[0] as ReturnType<typeof mcqItem>) };
    items[0].options = items[0].options.slice(0, 3);
    const { service } = makeService(async () => ({ ...validMultipleChoiceClozeResponse(), items }));

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a dangling acceptedOptionIds not present in options', async () => {
    const items = Array.from({ length: 8 }, (_, i) => mcqItem(i + 1));
    items[0] = { ...(items[0] as ReturnType<typeof mcqItem>) };
    items[0].answerKey = { kind: 'single_choice', acceptedOptionIds: ['not-a-real-option'] };
    const { service } = makeService(async () => ({ ...validMultipleChoiceClozeResponse(), items }));

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects an open_cloze item with non-null options', async () => {
    const items = Array.from({ length: 8 }, (_, i) => textItem(i + 1));
    items[0] = {
      ...(items[0] as ReturnType<typeof textItem>),
      options: mcqItem(1).options as never,
    };
    const { service } = makeService(async () => ({ ...validOpenClozeResponse(), items }));

    await assert.rejects(
      () => service.execute(USER_ID, openClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a key_word_transformation response with a non-null stimulus', async () => {
    const { service } = makeService(async () => ({
      ...validKeyWordTransformationResponse(),
      stimulus: 'should not be here',
    }));

    await assert.rejects(
      () => service.execute(USER_ID, keyWordTransformationRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a response that is not a JSON object', async () => {
    const { service } = makeService(async () => ['not', 'an', 'object']);

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_INVALID_RESPONSE),
    );
  });
});

// ── provider failures ───────────────────────────────────────────────────────

describe('GeneratePracticeExerciseService.execute — provider failures', () => {
  it('maps a timeout to AI_REQUEST_TIMEOUT', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('OpenAI request timed out', LLMErrorCode.TIMEOUT);
    });

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_REQUEST_TIMEOUT),
    );
  });

  it('maps a provider rate limit to AI_RATE_LIMITED', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('OpenAI rate limit exceeded', LLMErrorCode.RATE_LIMITED);
    });

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_RATE_LIMITED),
    );
  });

  it('maps a missing API key to AI_CONFIGURATION_ERROR', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
    });

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) => assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_CONFIGURATION_ERROR),
    );
  });

  it('maps a generic provider outage to AI_PROVIDER_UNAVAILABLE', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('OpenAI request failed: 503', LLMErrorCode.PROVIDER_ERROR);
    });

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) =>
        assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_PROVIDER_UNAVAILABLE),
    );
  });

  it('maps a completely unexpected failure to AI_PROVIDER_UNAVAILABLE', async () => {
    const { service } = makeService(async () => {
      throw new Error('something nobody anticipated');
    });

    await assert.rejects(
      () => service.execute(USER_ID, multipleChoiceClozeRequest()),
      (err: unknown) =>
        assertGenErr(err, GeneratePracticeExerciseErrorCode.AI_PROVIDER_UNAVAILABLE),
    );
  });

  it('never leaks the raw provider error message to the caller', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError(
        'OpenAI request failed: invoice #12345 over billing limit for org-abc',
        LLMErrorCode.PROVIDER_ERROR,
      );
    });

    try {
      await service.execute(USER_ID, multipleChoiceClozeRequest());
      assert.fail('expected execute() to reject');
    } catch (err) {
      assert.ok(err instanceof GeneratePracticeExerciseError);
      assert.doesNotMatch(err.message, /invoice|billing|org-abc/);
    }
  });
});
