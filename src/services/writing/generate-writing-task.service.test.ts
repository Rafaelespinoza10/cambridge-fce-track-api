import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';

import {
  GenerateWritingTaskService,
  GenerateWritingTaskError,
  GenerateWritingTaskErrorCode,
} from './generate-writing-task.service';
import type { LLMServicePort, WritingTasksRepositoryPort } from './generate-writing-task.service';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import type { GenerateWritingTaskRequest } from '../../interfaces/writing/writing-task.interface';
import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';
import { WritingTaskType, EnglishLevel } from '../../models/enums';
import type { WritingTask } from '../../models/WritingTask';
import type { CreateTaskData } from '../../repositories/writing-tasks.repository';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const IDEMPOTENCY_KEY = 'aaaaaaaa-1111-1111-1111-111111111111';

function essayRequest(): GenerateWritingTaskRequest {
  return { taskType: WritingTaskType.ESSAY, idempotencyKey: IDEMPOTENCY_KEY };
}

function validResponse() {
  return {
    title: 'Technology in education',
    instructions:
      'In your English class you have been talking about technology in education. Write an essay using all the notes and giving reasons for your point of view.',
  };
}

const SAFE_TASK: WritingTaskSafeDto = {
  id: 'task-id',
  taskType: WritingTaskType.ESSAY,
  targetLevel: EnglishLevel.B2,
  title: 't',
  instructions: 'i',
  minWords: 140,
  maxWords: 190,
  timeLimitSeconds: 2400,
  createdAt: new Date(),
};

const FAKE_DATA_SOURCE = {
  transaction: async <T>(work: (manager: never) => Promise<T>) => work({} as never),
} as unknown as DataSource;

interface RepoCalls {
  createTask: CreateTaskData[];
  findByIdempotencyKeyForUser: { userId: string; idempotencyKey: string }[];
}

interface MakeServiceOverrides {
  findByIdempotencyKeyForUser?: (
    userId: string,
    idempotencyKey: string,
  ) => Promise<WritingTask | null>;
  createTask?: (data: CreateTaskData) => Promise<WritingTask>;
  findSafeTaskForUser?: () => Promise<WritingTaskSafeDto | null>;
}

function makeService(
  completeStructured: (
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ) => Promise<unknown>,
  overrides: MakeServiceOverrides = {},
): { service: GenerateWritingTaskService; calls: RepoCalls; llmCallCount: () => number } {
  const calls: RepoCalls = { createTask: [], findByIdempotencyKeyForUser: [] };
  let llmCalls = 0;
  const llm: LLMServicePort = {
    completeStructured: async (...args) => {
      llmCalls += 1;
      return completeStructured(...args);
    },
  };
  const writingTasks = (): WritingTasksRepositoryPort => ({
    createTask: async (data) => {
      calls.createTask.push(data);
      if (overrides.createTask) return overrides.createTask(data);
      return { id: 'task-id' } as WritingTask;
    },
    findSafeTaskForUser: overrides.findSafeTaskForUser ?? (async () => SAFE_TASK),
    findByIdempotencyKeyForUser: async (userId, idempotencyKey) => {
      calls.findByIdempotencyKeyForUser.push({ userId, idempotencyKey });
      if (overrides.findByIdempotencyKeyForUser) {
        return overrides.findByIdempotencyKeyForUser(userId, idempotencyKey);
      }
      return null;
    },
  });
  const service = new GenerateWritingTaskService(FAKE_DATA_SOURCE, {
    llm,
    providerLabel: 'openai',
    modelLabel: 'gpt-4o-mini',
    writingTasks,
  });
  return { service, calls, llmCallCount: () => llmCalls };
}

function assertGenErr(err: unknown, code: GenerateWritingTaskErrorCode): true {
  assert.ok(err instanceof GenerateWritingTaskError);
  assert.equal(err.code, code);
  return true;
}

describe('GenerateWritingTaskService.execute — happy path', () => {
  it('generates and persists an essay task with the fixed FCE word/time constraints', async () => {
    const { service, calls } = makeService(async () => validResponse());
    await service.execute(USER_ID, essayRequest());

    assert.equal(calls.createTask.length, 1);
    const data = calls.createTask[0]!;
    assert.equal(data.taskType, WritingTaskType.ESSAY);
    assert.equal(data.minWords, 140);
    assert.equal(data.maxWords, 190);
    assert.equal(data.timeLimitSeconds, 2400);
    assert.equal(data.title, 'Technology in education');
  });

  it('defaults targetLevel to B2 when not provided', async () => {
    const { service, calls } = makeService(async () => validResponse());
    await service.execute(USER_ID, essayRequest());
    assert.equal(calls.createTask[0]!.targetLevel, EnglishLevel.B2);
  });

  it('respects an explicit targetLevel', async () => {
    const { service, calls } = makeService(async () => validResponse());
    await service.execute(USER_ID, { ...essayRequest(), targetLevel: EnglishLevel.C1 });
    assert.equal(calls.createTask[0]!.targetLevel, EnglishLevel.C1);
  });

  it('the user prompt includes the target level and word range', async () => {
    let capturedMessages: LLMChatMessage[] | undefined;
    const { service } = makeService(async (messages) => {
      capturedMessages = messages;
      return validResponse();
    });
    await service.execute(USER_ID, essayRequest());
    const userContent = capturedMessages?.[1]?.content ?? '';
    assert.match(userContent, /B2/);
    assert.match(userContent, /140-190/);
  });
});

describe('GenerateWritingTaskService.execute — input validation', () => {
  it('rejects a non-essay taskType', async () => {
    const { service } = makeService(async () => validResponse());
    await assert.rejects(
      () =>
        service.execute(USER_ID, {
          ...essayRequest(),
          taskType: 'situational_writing' as WritingTaskType,
        }),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.INVALID_INPUT),
    );
  });

  it('rejects a missing idempotencyKey', async () => {
    const { service } = makeService(async () => validResponse());
    await assert.rejects(
      () => service.execute(USER_ID, { ...essayRequest(), idempotencyKey: '' }),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.INVALID_INPUT),
    );
  });
});

describe('GenerateWritingTaskService.execute — response validation', () => {
  it('rejects a response missing instructions', async () => {
    const { service } = makeService(async () => ({ title: 'Only a title' }));
    await assert.rejects(
      () => service.execute(USER_ID, essayRequest()),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('rejects a blank title', async () => {
    const { service } = makeService(async () => ({ ...validResponse(), title: '   ' }));
    await assert.rejects(
      () => service.execute(USER_ID, essayRequest()),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE),
    );
  });
});

describe('GenerateWritingTaskService.execute — idempotency', () => {
  it('replays without calling the LLM when the idempotency key already has a task', async () => {
    const existingTask = { id: 'existing-task-id' } as WritingTask;
    const { service, llmCallCount } = makeService(async () => validResponse(), {
      findByIdempotencyKeyForUser: async () => existingTask,
      findSafeTaskForUser: async () => SAFE_TASK,
    });
    const result = await service.execute(USER_ID, essayRequest());
    assert.equal(llmCallCount(), 0);
    assert.deepEqual(result, SAFE_TASK);
  });

  it('replays on a race — createTask fails with the idempotency unique-constraint violation', async () => {
    const raceError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'uq_writing_tasks_user_idempotency',
    });
    let findCallCount = 0;
    const { service } = makeService(async () => validResponse(), {
      findByIdempotencyKeyForUser: async () => {
        findCallCount += 1;
        return findCallCount === 1 ? null : ({ id: 'raced-task-id' } as WritingTask);
      },
      createTask: async () => {
        throw raceError;
      },
      findSafeTaskForUser: async () => SAFE_TASK,
    });
    const result = await service.execute(USER_ID, essayRequest());
    assert.deepEqual(result, SAFE_TASK);
  });

  it('a genuinely different DB error is not swallowed as a replay', async () => {
    const { service } = makeService(async () => validResponse(), {
      createTask: async () => {
        throw new Error('connection reset');
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, essayRequest()),
      (err: unknown) => {
        assert.ok(!(err instanceof GenerateWritingTaskError));
        return true;
      },
    );
  });
});

describe('GenerateWritingTaskService.execute — LLM provider failures', () => {
  it('maps a timeout to AI_REQUEST_TIMEOUT', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('timed out', LLMErrorCode.TIMEOUT);
    });
    await assert.rejects(
      () => service.execute(USER_ID, essayRequest()),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.AI_REQUEST_TIMEOUT),
    );
  });

  it('maps a rate limit to AI_RATE_LIMITED', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('rate limited', LLMErrorCode.RATE_LIMITED);
    });
    await assert.rejects(
      () => service.execute(USER_ID, essayRequest()),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.AI_RATE_LIMITED),
    );
  });

  it('maps a missing API key to AI_CONFIGURATION_ERROR', async () => {
    const { service } = makeService(async () => {
      throw new LLMServiceError('not configured', LLMErrorCode.NOT_CONFIGURED);
    });
    await assert.rejects(
      () => service.execute(USER_ID, essayRequest()),
      (err: unknown) => assertGenErr(err, GenerateWritingTaskErrorCode.AI_CONFIGURATION_ERROR),
    );
  });
});
