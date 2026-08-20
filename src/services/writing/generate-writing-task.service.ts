/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, WritingTaskType, PracticeExerciseSource } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type {
  GenerateWritingTaskRequest,
  WritingTaskSafeDto,
} from '../../interfaces/writing/writing-task.interface';
import type { WritingTaskGenerationMetadata } from '../../models/writing-json-types';
import type { WritingTask } from '../../models/WritingTask';
import { renderPromptTemplate } from '../../lib/prompt-template';
import { getWritingTaskFormat } from '../../lib/writing-task-catalog';
import { pickRandomExamTopic } from '../../lib/exam-topics';
import { WritingTasksRepository } from '../../repositories/writing-tasks.repository';
import type { CreateTaskData } from '../../repositories/writing-tasks.repository';
import SYSTEM_PROMPT_TEMPLATE from '../../prompts/writing/generate-task.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/writing/generate-task.user.md';

const PROMPT_VERSION = 'writing-task-v3';

export enum GenerateWritingTaskErrorCode {
  INVALID_INPUT = 'invalid_input',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
}

export class GenerateWritingTaskError extends Error {
  constructor(
    message: string,
    readonly code: GenerateWritingTaskErrorCode,
  ) {
    super(message);
    this.name = 'GenerateWritingTaskError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

type RepositorySource = DataSource | EntityManager;

/** Narrow port over WritingTasksRepository — only the methods this service calls. */
export interface WritingTasksRepositoryPort {
  createTask(data: CreateTaskData): Promise<WritingTask>;
  findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null>;
  findByIdempotencyKeyForUser(userId: string, idempotencyKey: string): Promise<WritingTask | null>;
}

export interface GenerateWritingTaskServiceDeps {
  llm: LLMServicePort;
  /** The provider/model actually used — informational only, written to generationMetadata. */
  providerLabel: string;
  modelLabel: string | null;
  writingTasks?: (source: RepositorySource) => WritingTasksRepositoryPort;
}

const DEFAULT_WRITING_TASKS_FACTORY = (source: RepositorySource): WritingTasksRepositoryPort =>
  new WritingTasksRepository(source);

const REQUEST_TIMEOUT_MS = 25_000;
const RESPONSE_TEMPERATURE = 0.7;
const RESPONSE_MAX_OUTPUT_TOKENS = 1000;

const TITLE_MAX_LENGTH = 255;
const INSTRUCTIONS_MAX_LENGTH = 2000;

const VALID_ENGLISH_LEVELS = new Set<string>(Object.values(EnglishLevel));

interface NormalizedRequest {
  taskType: WritingTaskType;
  targetLevel: EnglishLevel;
}

function invalidInput(message: string): never {
  throw new GenerateWritingTaskError(message, GenerateWritingTaskErrorCode.INVALID_INPUT);
}

const VALID_TASK_TYPES = new Set<string>(Object.values(WritingTaskType));

function normalizeRequest(input: GenerateWritingTaskRequest): NormalizedRequest {
  if (typeof input.taskType !== 'string' || !VALID_TASK_TYPES.has(input.taskType)) {
    invalidInput(`taskType must be one of: ${Object.values(WritingTaskType).join(', ')}`);
  }

  let targetLevel = EnglishLevel.B2;
  if (input.targetLevel !== undefined) {
    if (typeof input.targetLevel !== 'string' || !VALID_ENGLISH_LEVELS.has(input.targetLevel)) {
      invalidInput('targetLevel must be a valid English level');
    }
    targetLevel = input.targetLevel;
  }

  return { taskType: input.taskType, targetLevel };
}

function buildMessages(normalized: NormalizedRequest): LLMChatMessage[] {
  const format = getWritingTaskFormat(normalized.taskType);
  const part = `Part ${format.part}`;

  const systemPrompt = renderPromptTemplate(SYSTEM_PROMPT_TEMPLATE, {
    part,
    taskTypeLabel: format.label,
    formatBrief: format.formatBrief,
  });
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    part,
    taskTypeLabel: format.label,
    targetLevel: normalized.targetLevel,
    minWords: String(format.minWords),
    maxWords: String(format.maxWords),
    topicHint: pickRandomExamTopic(),
  });
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

const RESPONSE_SCHEMA: LLMJsonSchema = {
  name: 'writing_task',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'instructions'],
    properties: {
      title: { type: 'string', description: 'Short title for the writing task.' },
      instructions: {
        type: 'string',
        description:
          'Full task instructions as they would appear on a real Cambridge exam paper — context/input notes plus the content points to address.',
      },
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new GenerateWritingTaskError(message, GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE);
}

function validateText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') invalidResponse(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') invalidResponse(`${field} must not be empty`);
  if (trimmed.length > maxLength) invalidResponse(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function validateGeneratedTask(value: unknown): { title: string; instructions: string } {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');

  const title = validateText(value.title, 'title', TITLE_MAX_LENGTH);
  const instructions = validateText(value.instructions, 'instructions', INSTRUCTIONS_MAX_LENGTH);

  return { title, instructions };
}

const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_writing_tasks_user_idempotency';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

// Same detection pattern as GeneratePracticeExerciseService's idempotency
// handling — matches on the specific constraint name, not just the Postgres
// error code, so an unrelated unique violation is never mistaken for a replay.
function isIdempotencyConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === IDEMPOTENCY_CONSTRAINT_NAME;
}

function mapLLMError(error: unknown): GenerateWritingTaskError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new GenerateWritingTaskError(
          'The AI provider is not configured correctly',
          GenerateWritingTaskErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new GenerateWritingTaskError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          GenerateWritingTaskErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new GenerateWritingTaskError(
          'The AI provider took too long to respond',
          GenerateWritingTaskErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new GenerateWritingTaskError(
          'The AI provider is currently unavailable',
          GenerateWritingTaskErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new GenerateWritingTaskError(
          'The AI provider returned an invalid response',
          GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new GenerateWritingTaskError(
    'The AI provider returned an unexpected error',
    GenerateWritingTaskErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/**
 * Generates a Cambridge B2 First Writing task (Part 1 essay, or a Part 2
 * article/email/report/review — see writing-task-catalog.ts) via the LLM,
 * validates the response, and persists it — mirrors
 * GeneratePracticeExerciseService's shape exactly (idempotency pre-check,
 * LLM call before any DB transaction opens, transactional persist, replay
 * on idempotency-constraint race).
 */
export class GenerateWritingTaskService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GenerateWritingTaskServiceDeps,
  ) {}

  async execute(userId: string, input: GenerateWritingTaskRequest): Promise<WritingTaskSafeDto> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      invalidInput('userId is required');
    }
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.trim() === '') {
      invalidInput('idempotencyKey is required');
    }

    const normalized = normalizeRequest(input);

    // Idempotency pre-check: same user + same key never reaches the LLM at
    // all, not even once.
    const factory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
    const existing = await factory(this.dataSource).findByIdempotencyKeyForUser(
      userId,
      input.idempotencyKey,
    );
    if (existing !== null) {
      return this.buildReplayResult(this.dataSource, userId, input.idempotencyKey);
    }

    const messages = buildMessages(normalized);

    let raw: unknown;
    try {
      raw = await this.deps.llm.completeStructured(messages, {
        responseSchema: RESPONSE_SCHEMA,
        timeoutMs: REQUEST_TIMEOUT_MS,
        temperature: RESPONSE_TEMPERATURE,
        maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
      });
    } catch (err: unknown) {
      throw mapLLMError(err);
    }

    const generated = validateGeneratedTask(raw);
    const generationMetadata: WritingTaskGenerationMetadata = {
      provider: this.deps.providerLabel,
      schemaVersion: PROMPT_VERSION,
    };

    try {
      return await this.dataSource.transaction((manager) =>
        this.persist(
          manager,
          userId,
          input.idempotencyKey,
          normalized,
          generated,
          generationMetadata,
        ),
      );
    } catch (err: unknown) {
      if (isIdempotencyConstraintViolation(err)) {
        return this.buildReplayResult(this.dataSource, userId, input.idempotencyKey);
      }
      throw err;
    }
  }

  private async buildReplayResult(
    source: RepositorySource,
    userId: string,
    idempotencyKey: string,
  ): Promise<WritingTaskSafeDto> {
    const factory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
    const repo = factory(source);

    const existing = await repo.findByIdempotencyKeyForUser(userId, idempotencyKey);
    if (existing === null) {
      throw new GenerateWritingTaskError(
        'Idempotency conflict detected but no matching task could be found',
        GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE,
      );
    }

    const safe = await repo.findSafeTaskForUser(existing.id, userId);
    if (safe === null) {
      throw new GenerateWritingTaskError(
        'Idempotency conflict detected but the matching task could not be re-read',
        GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE,
      );
    }
    return safe;
  }

  private async persist(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    normalized: NormalizedRequest,
    generated: { title: string; instructions: string },
    generationMetadata: WritingTaskGenerationMetadata,
  ): Promise<WritingTaskSafeDto> {
    const factory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
    const repo = factory(manager);
    const format = getWritingTaskFormat(normalized.taskType);

    const taskData: CreateTaskData = {
      userId,
      idempotencyKey,
      taskType: normalized.taskType,
      targetLevel: normalized.targetLevel,
      title: generated.title,
      instructions: generated.instructions,
      minWords: format.minWords,
      maxWords: format.maxWords,
      timeLimitSeconds: format.timeLimitSeconds,
      source: PracticeExerciseSource.AI,
      model: this.deps.modelLabel,
      promptVersion: PROMPT_VERSION,
      generationMetadata,
    };
    const task = await repo.createTask(taskData);

    const safe = await repo.findSafeTaskForUser(task.id, userId);
    if (safe === null) {
      // Unreachable within the same transaction (read-your-writes), but
      // fail loudly rather than return a bogus empty result.
      throw new GenerateWritingTaskError(
        'Failed to read back the task that was just persisted',
        GenerateWritingTaskErrorCode.AI_INVALID_RESPONSE,
      );
    }
    return safe;
  }
}
