/// <reference path="../../types/markdown.d.ts" />
import { randomUUID } from 'crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { EnglishLevel, DailySessionSource } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type {
  GenerateDailySessionRequest,
  DailySessionSafeWithItems,
} from '../../interfaces/daily-session/daily-session.interface';
import type {
  DailySessionItemOption,
  DailySessionItemAnswerKey,
  DailySessionSentenceTarget,
  DailySessionGenerationMetadata,
} from '../../models/daily-session-json-types';
import type { DailySession } from '../../models/DailySession';
import type { DailySessionItem } from '../../models/DailySessionItem';
import {
  isDailySessionItemAnswerKey,
  isDailySessionItemOptionArray,
  normalizeSkillTags,
} from '@lib/daily-session/daily-session-jsonb-validators';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { pickRandomExamTopic } from '@lib/shared/exam-topics';
import { resolveLocalDay, isValidTimeZone } from '@lib/shared/timezone';
import { UsersRepository } from '@repositories/users/users.repository';
import { DailySessionsRepository } from '@repositories/daily-session/daily-sessions.repository';
import type {
  CreateSessionData,
  CreateItemData,
} from '@repositories/daily-session/daily-sessions.repository';
import type { User } from '../../models/User';
import SYSTEM_PROMPT from '../../prompts/daily-session/generate-session.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/daily-session/generate-session.user.md';

const PROMPT_VERSION = 'daily-session-v1';
const DEFAULT_TIMEZONE = 'UTC';
const ITEM_COUNT = 5;
const SENTENCE_TARGET_COUNT = 3;

export enum GenerateDailySessionErrorCode {
  INVALID_INPUT = 'invalid_input',
  INVALID_TIMEZONE = 'invalid_timezone',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
}

export class GenerateDailySessionError extends Error {
  constructor(
    message: string,
    readonly code: GenerateDailySessionErrorCode,
  ) {
    super(message);
    this.name = 'GenerateDailySessionError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

/** Narrow port over SearchCambridgeKnowledgeService — grounding is optional, never required. */
export interface SearchKnowledgePort {
  execute(filters: {
    skill?: string;
    topic?: string;
    limit?: number;
  }): Promise<{ content: string; sourceName: string; sourcePage: number }[]>;
}

type RepositorySource = DataSource | EntityManager;

export interface UsersRepositoryPort {
  findUserWithProfile(userId: string): Promise<User | null>;
}

/** Narrow port over DailySessionsRepository — only the methods this service calls. */
export interface DailySessionsRepositoryPort {
  createSession(data: CreateSessionData): Promise<DailySession>;
  createItems(sessionId: string, items: CreateItemData[]): Promise<DailySessionItem[]>;
  findSafeSessionForUser(
    sessionId: string,
    userId: string,
  ): Promise<DailySessionSafeWithItems | null>;
  findByUserAndSessionDate(userId: string, sessionDate: string): Promise<DailySession | null>;
}

type GeneratedItem = CreateItemData;

export interface GenerateDailySessionServiceDeps {
  llm: LLMServicePort;
  /** The provider/model actually used — informational only, written to generationMetadata. */
  providerLabel: string;
  modelLabel: string | null;
  users?: (source: RepositorySource) => UsersRepositoryPort;
  dailySessions?: (source: RepositorySource) => DailySessionsRepositoryPort;
  /** Best-effort grounding — a Knowledge Base miss never fails generation. */
  searchKnowledge?: SearchKnowledgePort;
}

const REQUEST_TIMEOUT_MS = 25_000;
const RESPONSE_TEMPERATURE = 0.6;
const RESPONSE_MAX_OUTPUT_TOKENS = 3000;

const TITLE_MAX_LENGTH = 255;
const INSTRUCTIONS_MAX_LENGTH = 2000;
const PASSAGE_MAX_LENGTH = 6000;
const PROMPT_MAX_LENGTH = 2000;
const EXPLANATION_MAX_LENGTH = 2000;
const OPTION_LABEL_MAX_LENGTH = 200;
const SKILL_TAGS_MAX_COUNT = 5;
const SENTENCE_TASK_INSTRUCTIONS_MAX_LENGTH = 1000;
const TARGET_TEXT_MAX_LENGTH = 100;
const HINT_MAX_LENGTH = 200;
const GROUNDING_CHUNK_MAX_LENGTH = 800;

const VALID_ENGLISH_LEVELS = new Set<string>(Object.values(EnglishLevel));

function invalidInput(message: string): never {
  throw new GenerateDailySessionError(message, GenerateDailySessionErrorCode.INVALID_INPUT);
}

function resolveTargetLevel(input: GenerateDailySessionRequest): EnglishLevel {
  if (input.targetLevel === undefined) return EnglishLevel.B2;
  if (typeof input.targetLevel !== 'string' || !VALID_ENGLISH_LEVELS.has(input.targetLevel)) {
    invalidInput('targetLevel must be a valid English level');
  }
  return input.targetLevel;
}

interface GroundingResult {
  excerptsBlock: string;
  knowledgeSourceNames: string[];
}

/**
 * Folds up to 2 batches of Knowledge Base search results into a single,
 * clearly-labeled "reference only" block. Only `content` (truncated) goes
 * into the prompt; only `sourceName`/`sourcePage` get persisted afterwards
 * (generation_metadata.knowledgeSourceNames) — the raw chunk content is
 * never stored, per docs/cambridge-knowledge-base.md §8/§9.
 */
function buildGroundingResult(
  chunks: { content: string; sourceName: string; sourcePage: number }[],
): GroundingResult {
  if (chunks.length === 0) {
    return {
      excerptsBlock:
        'No additional grounding material was found for this topic — write original material as usual.',
      knowledgeSourceNames: [],
    };
  }
  const excerpts = chunks
    .map((chunk) => `- "${chunk.content.slice(0, GROUNDING_CHUNK_MAX_LENGTH).trim()}"`)
    .join('\n');
  return {
    excerptsBlock: [
      'Real Cambridge B2 First material for this topic area, from the Cambridge',
      'Knowledge Base. Use it only to keep vocabulary, register and topic',
      'treatment authentic — never copy it verbatim, and never present it as',
      'the passage itself:',
      excerpts,
    ].join('\n'),
    knowledgeSourceNames: chunks.map((chunk) => `${chunk.sourceName} p.${chunk.sourcePage}`),
  };
}

function buildMessages(
  targetLevel: EnglishLevel,
  topicHint: string,
  groundingExcerpts: string,
): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    topicHint,
    targetLevel,
    itemCount: String(ITEM_COUNT),
    sentenceTargetCount: String(SENTENCE_TARGET_COUNT),
    groundingExcerpts,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

const RESPONSE_SCHEMA: LLMJsonSchema = {
  name: 'daily_session',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'readingTitle',
      'readingInstructions',
      'readingPassage',
      'items',
      'sentenceTaskInstructions',
      'sentenceTargets',
    ],
    properties: {
      readingTitle: { type: 'string' },
      readingInstructions: { type: 'string' },
      readingPassage: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['position', 'prompt', 'options', 'answerKey', 'explanation', 'skillTags'],
          properties: {
            position: { type: 'integer', description: '1-based position, no gaps or repeats.' },
            prompt: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'label'],
                properties: { id: { type: 'string' }, label: { type: 'string' } },
              },
            },
            answerKey: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'acceptedOptionIds'],
              properties: {
                kind: { type: 'string', enum: ['single_choice'] },
                acceptedOptionIds: { type: 'array', items: { type: 'string' } },
              },
            },
            explanation: { type: 'string' },
            skillTags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      sentenceTaskInstructions: { type: 'string' },
      sentenceTargets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetText', 'hint'],
          properties: {
            targetText: { type: 'string' },
            hint: { type: 'string' },
          },
        },
      },
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new GenerateDailySessionError(message, GenerateDailySessionErrorCode.AI_INVALID_RESPONSE);
}

function validateText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') invalidResponse(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') invalidResponse(`${field} must not be empty`);
  if (trimmed.length > maxLength) invalidResponse(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

function validateOptions(value: unknown, position: number): DailySessionItemOption[] {
  if (!isDailySessionItemOptionArray(value)) {
    invalidResponse(`item at position ${position} has invalid options`);
  }
  if (value.length !== 4) {
    invalidResponse(`item at position ${position} must have exactly 4 options`);
  }
  for (const option of value) {
    if (option.label.length > OPTION_LABEL_MAX_LENGTH) {
      invalidResponse(`item at position ${position} has an option label that is too long`);
    }
  }
  return value;
}

function validateAnswerKey(
  value: unknown,
  position: number,
  options: DailySessionItemOption[],
): DailySessionItemAnswerKey {
  if (!isDailySessionItemAnswerKey(value) || value.kind !== 'single_choice') {
    invalidResponse(`item at position ${position} has an invalid answerKey`);
  }
  if (value.acceptedOptionIds.length !== 1) {
    invalidResponse(`item at position ${position} must have exactly one accepted option`);
  }
  const optionIds = new Set(options.map((option) => option.id));
  if (!value.acceptedOptionIds.every((id) => optionIds.has(id))) {
    invalidResponse(`item at position ${position} has an acceptedOptionIds not present in options`);
  }
  return value;
}

function validateItems(value: unknown): GeneratedItem[] {
  if (!Array.isArray(value)) invalidResponse('items must be an array');
  if (value.length !== ITEM_COUNT) {
    invalidResponse(`items must contain exactly ${ITEM_COUNT} entries, got ${value.length}`);
  }

  const items = value.map((raw, index): GeneratedItem => {
    if (!isPlainObject(raw)) invalidResponse(`item at index ${index} must be an object`);

    const position = raw.position;
    if (typeof position !== 'number' || !Number.isInteger(position)) {
      invalidResponse(`item at index ${index} has a non-integer position`);
    }

    const prompt = validateText(
      raw.prompt,
      `item at position ${position} prompt`,
      PROMPT_MAX_LENGTH,
    );
    const options = validateOptions(raw.options, position);
    const answerKey = validateAnswerKey(raw.answerKey, position, options);
    const explanation = validateText(
      raw.explanation,
      `item at position ${position} explanation`,
      EXPLANATION_MAX_LENGTH,
    );
    const skillTags = normalizeSkillTags(raw.skillTags).slice(0, SKILL_TAGS_MAX_COUNT);

    return { position, prompt, options, answerKey, explanation, skillTags };
  });

  const positions = items.map((item) => item.position).sort((a, b) => a - b);
  const expectedPositions = Array.from({ length: ITEM_COUNT }, (_, i) => i + 1);
  if (JSON.stringify(positions) !== JSON.stringify(expectedPositions)) {
    invalidResponse('item positions must be exactly 1..N with no gaps or duplicates');
  }

  return items;
}

function validateSentenceTargets(value: unknown): DailySessionSentenceTarget[] {
  if (!Array.isArray(value)) invalidResponse('sentenceTargets must be an array');
  if (value.length !== SENTENCE_TARGET_COUNT) {
    invalidResponse(
      `sentenceTargets must contain exactly ${SENTENCE_TARGET_COUNT} entries, got ${value.length}`,
    );
  }

  const targets = value.map((raw, index): DailySessionSentenceTarget => {
    if (!isPlainObject(raw)) invalidResponse(`sentenceTarget at index ${index} must be an object`);
    const targetText = validateText(
      raw.targetText,
      `sentenceTarget at index ${index} targetText`,
      TARGET_TEXT_MAX_LENGTH,
    );
    const hint = validateText(raw.hint, `sentenceTarget at index ${index} hint`, HINT_MAX_LENGTH);
    // The LLM never assigns ids — server-generated so they're guaranteed
    // unique and stable for matching a student's submission 1:1 later.
    return { id: randomUUID(), targetText, hint };
  });

  const lowerTexts = targets.map((target) => target.targetText.toLowerCase());
  if (new Set(lowerTexts).size !== lowerTexts.length) {
    invalidResponse('sentenceTargets must not contain duplicate targetText values');
  }

  return targets;
}

interface GeneratedSession {
  readingTitle: string;
  readingInstructions: string;
  readingPassage: string;
  items: GeneratedItem[];
  sentenceTaskInstructions: string;
  sentenceTargets: DailySessionSentenceTarget[];
}

function validateGeneratedSession(value: unknown): GeneratedSession {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');

  const readingTitle = validateText(value.readingTitle, 'readingTitle', TITLE_MAX_LENGTH);
  const readingInstructions = validateText(
    value.readingInstructions,
    'readingInstructions',
    INSTRUCTIONS_MAX_LENGTH,
  );
  const readingPassage = validateText(value.readingPassage, 'readingPassage', PASSAGE_MAX_LENGTH);
  const items = validateItems(value.items);
  const sentenceTaskInstructions = validateText(
    value.sentenceTaskInstructions,
    'sentenceTaskInstructions',
    SENTENCE_TASK_INSTRUCTIONS_MAX_LENGTH,
  );
  const sentenceTargets = validateSentenceTargets(value.sentenceTargets);

  return {
    readingTitle,
    readingInstructions,
    readingPassage,
    items,
    sentenceTaskInstructions,
    sentenceTargets,
  };
}

const IDEMPOTENCY_CONSTRAINT_NAME = 'uq_daily_sessions_user_session_date';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

// Same detection pattern as GeneratePracticeExerciseService — matches on the
// specific constraint name, not just the Postgres error code, so an
// unrelated unique violation is never mistaken for a replay.
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

function mapLLMError(error: unknown): GenerateDailySessionError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new GenerateDailySessionError(
          'The AI provider is not configured correctly',
          GenerateDailySessionErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new GenerateDailySessionError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          GenerateDailySessionErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new GenerateDailySessionError(
          'The AI provider took too long to respond',
          GenerateDailySessionErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new GenerateDailySessionError(
          'The AI provider is currently unavailable',
          GenerateDailySessionErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new GenerateDailySessionError(
          'The AI provider returned an invalid response',
          GenerateDailySessionErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new GenerateDailySessionError(
    'The AI provider returned an unexpected error',
    GenerateDailySessionErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

const DEFAULT_USERS_FACTORY = (source: RepositorySource): UsersRepositoryPort =>
  new UsersRepository(source);
const DEFAULT_DAILY_SESSIONS_FACTORY = (source: RepositorySource): DailySessionsRepositoryPort =>
  new DailySessionsRepository(source);

/**
 * Generates one Daily Session (reading passage + comprehension items +
 * sentence-writing task) per user per calendar day. "Daily" is itself the
 * idempotency key — (userId, sessionDate) is server-derived from the user's
 * profile timezone, never a client-supplied UUID like Practice/Writing use.
 * The LLM call always happens before any DB transaction opens — never hold a
 * transaction across network I/O.
 */
export class GenerateDailySessionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: GenerateDailySessionServiceDeps,
  ) {}

  async execute(
    userId: string,
    requestedAt: Date,
    input: GenerateDailySessionRequest = {},
  ): Promise<DailySessionSafeWithItems> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (!(requestedAt instanceof Date) || Number.isNaN(requestedAt.getTime())) {
      invalidInput('requestedAt must be a valid Date');
    }
    const targetLevel = resolveTargetLevel(input);

    const usersFactory = this.deps.users ?? DEFAULT_USERS_FACTORY;
    const user = await usersFactory(this.dataSource).findUserWithProfile(userId);
    if (user === null) invalidInput('user not found');

    const profile = user.profile as User['profile'] | null;
    let timezone = DEFAULT_TIMEZONE;
    if (profile !== null && profile !== undefined && profile.timezone !== null) {
      if (!isValidTimeZone(profile.timezone)) {
        throw new GenerateDailySessionError(
          `Invalid IANA timezone stored in user profile: ${profile.timezone}`,
          GenerateDailySessionErrorCode.INVALID_TIMEZONE,
        );
      }
      timezone = profile.timezone;
    }

    const { localDate: sessionDate } = resolveLocalDay(requestedAt, timezone);

    // Idempotency pre-check: same user + same calendar day never reaches the
    // LLM or the Knowledge Base at all — this is the primary path, the
    // race-condition catch below only covers two concurrent requests racing
    // past this check.
    const sessionsFactory = this.deps.dailySessions ?? DEFAULT_DAILY_SESSIONS_FACTORY;
    const existing = await sessionsFactory(this.dataSource).findByUserAndSessionDate(
      userId,
      sessionDate,
    );
    if (existing !== null) {
      return this.buildReplayResult(this.dataSource, userId, sessionDate);
    }

    const topicHint = pickRandomExamTopic();

    let grounding: GroundingResult = { excerptsBlock: '', knowledgeSourceNames: [] };
    if (this.deps.searchKnowledge !== undefined) {
      // Grounding is a quality improvement, never a hard requirement — a
      // Knowledge Base miss (or an empty corpus) still lets generation
      // proceed with buildGroundingResult's "no material found" fallback.
      const readingChunks = await this.deps.searchKnowledge.execute({
        topic: topicHint,
        skill: 'reading',
        limit: 3,
      });
      const vocabChunks = await this.deps.searchKnowledge.execute({
        topic: topicHint,
        limit: 3,
      });
      grounding = buildGroundingResult([...readingChunks, ...vocabChunks]);
    } else {
      grounding = buildGroundingResult([]);
    }

    const messages = buildMessages(targetLevel, topicHint, grounding.excerptsBlock);

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

    const generated = validateGeneratedSession(raw);
    const generationMetadata: DailySessionGenerationMetadata = {
      provider: this.deps.providerLabel,
      topic: topicHint,
      knowledgeSourceNames: grounding.knowledgeSourceNames,
      schemaVersion: PROMPT_VERSION,
    };

    try {
      return await this.dataSource.transaction((manager) =>
        this.persist(
          manager,
          userId,
          sessionDate,
          timezone,
          targetLevel,
          generated,
          generationMetadata,
        ),
      );
    } catch (err: unknown) {
      // Two concurrent requests for the same (userId, sessionDate) can both
      // pass the pre-check above and both reach this insert — exactly one
      // wins, the other's transaction aborts on the unique index. Only THIS
      // specific constraint counts as a replay; any other 23505 (or any
      // other error) propagates normally.
      if (isIdempotencyConstraintViolation(err)) {
        return this.buildReplayResult(this.dataSource, userId, sessionDate);
      }
      throw err;
    }
  }

  /** Re-reads outside the aborted/committed transaction — never trusts anything from within it. */
  private async buildReplayResult(
    source: RepositorySource,
    userId: string,
    sessionDate: string,
  ): Promise<DailySessionSafeWithItems> {
    const factory = this.deps.dailySessions ?? DEFAULT_DAILY_SESSIONS_FACTORY;
    const repo = factory(source);

    const existing = await repo.findByUserAndSessionDate(userId, sessionDate);
    if (existing === null) {
      throw new GenerateDailySessionError(
        'Idempotency conflict detected but no matching session could be found',
        GenerateDailySessionErrorCode.AI_INVALID_RESPONSE,
      );
    }

    const safe = await repo.findSafeSessionForUser(existing.id, userId);
    if (safe === null) {
      throw new GenerateDailySessionError(
        'Idempotency conflict detected but the matching session could not be re-read',
        GenerateDailySessionErrorCode.AI_INVALID_RESPONSE,
      );
    }
    return safe;
  }

  private async persist(
    manager: EntityManager,
    userId: string,
    sessionDate: string,
    timezone: string,
    targetLevel: EnglishLevel,
    generated: GeneratedSession,
    generationMetadata: DailySessionGenerationMetadata,
  ): Promise<DailySessionSafeWithItems> {
    const factory = this.deps.dailySessions ?? DEFAULT_DAILY_SESSIONS_FACTORY;
    const repo = factory(manager);

    const sessionData: CreateSessionData = {
      userId,
      sessionDate,
      timezone,
      targetLevel,
      topic: generationMetadata.topic ?? 'general',
      readingTitle: generated.readingTitle,
      readingInstructions: generated.readingInstructions,
      readingPassage: generated.readingPassage,
      itemCount: ITEM_COUNT,
      sentenceTaskInstructions: generated.sentenceTaskInstructions,
      sentenceTargets: generated.sentenceTargets,
      source: DailySessionSource.AI,
      model: this.deps.modelLabel,
      promptVersion: PROMPT_VERSION,
      generationMetadata,
    };
    const session = await repo.createSession(sessionData);

    const itemsData: CreateItemData[] = generated.items;
    await repo.createItems(session.id, itemsData);

    const safe = await repo.findSafeSessionForUser(session.id, userId);
    if (safe === null) {
      // Unreachable within the same transaction (read-your-writes), but
      // fail loudly rather than return a bogus empty result.
      throw new GenerateDailySessionError(
        'Failed to read back the session that was just persisted',
        GenerateDailySessionErrorCode.AI_INVALID_RESPONSE,
      );
    }
    return safe;
  }
}
