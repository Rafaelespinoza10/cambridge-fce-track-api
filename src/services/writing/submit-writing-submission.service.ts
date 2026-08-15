/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { WritingSubmissionStatus } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type { WritingSubmission } from '../../models/WritingSubmission';
import type { WritingTask } from '../../models/WritingTask';
import type {
  WritingCorrection,
  WritingCorrectionCategory,
  WritingCriterionFeedback,
  WritingFeedback,
} from '../../models/writing-json-types';
import type { WritingSubmissionSubmitResultDto } from '../../interfaces/writing/writing-submission.interface';
import { renderPromptTemplate } from '../../lib/prompt-template';
import { buildWritingSubmissionResultDto } from '../../lib/writing-submission-result-dto';
import { WritingTasksRepository } from '../../repositories/writing-tasks.repository';
import { WritingSubmissionsRepository } from '../../repositories/writing-submissions.repository';
import type { GradeSubmissionData } from '../../repositories/writing-submissions.repository';
import SYSTEM_PROMPT from '../../prompts/writing/grade-submission.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/writing/grade-submission.user.md';

export enum SubmitWritingSubmissionErrorCode {
  INVALID_INPUT = 'invalid_input',
  SUBMISSION_NOT_FOUND = 'submission_not_found',
  SUBMISSION_ABANDONED = 'submission_abandoned',
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class SubmitWritingSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: SubmitWritingSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'SubmitWritingSubmissionError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

type RepositorySource = DataSource | EntityManager;

export interface WritingTasksRepositoryPort {
  findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null>;
}

export interface WritingSubmissionsRepositoryPort {
  findByIdForUser(submissionId: string, userId: string): Promise<WritingSubmission | null>;
  findByIdForUpdate(
    submissionId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<WritingSubmission | null>;
  gradeSubmission(
    submissionId: string,
    userId: string,
    data: GradeSubmissionData,
    manager: EntityManager,
  ): Promise<{ affected?: number | null }>;
}

export interface SubmitWritingSubmissionServiceDeps {
  llm: LLMServicePort;
  writingTasks?: (source: RepositorySource) => WritingTasksRepositoryPort;
  writingSubmissions?: (source: RepositorySource) => WritingSubmissionsRepositoryPort;
}

const DEFAULT_WRITING_TASKS_FACTORY = (source: RepositorySource): WritingTasksRepositoryPort =>
  new WritingTasksRepository(source);
const DEFAULT_WRITING_SUBMISSIONS_FACTORY = (
  source: RepositorySource,
): WritingSubmissionsRepositoryPort => new WritingSubmissionsRepository(source);

const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_TEMPERATURE = 0.3;
const RESPONSE_MAX_OUTPUT_TOKENS = 3000;

const SUBMITTED_TEXT_MAX_LENGTH = 6000;
const JUSTIFICATION_MAX_LENGTH = 1000;
const EVIDENCE_QUOTE_MAX_LENGTH = 300;
const EXCERPT_MAX_LENGTH = 500;
const EXPLANATION_MAX_LENGTH = 500;
const SUMMARY_MAX_LENGTH = 2000;
const REWRITTEN_TEXT_MAX_LENGTH = 4000;
const MAX_CORRECTIONS = 15;
const MAX_RAW_CORRECTIONS = 30;

const REQUIRED_CRITERIA = [
  'content',
  'communicative_achievement',
  'organization',
  'language',
] as const;
const VALID_CORRECTION_CATEGORIES = new Set<string>([
  'grammar',
  'vocabulary',
  'spelling',
  'punctuation',
  'register',
  'other',
]);

function invalidInput(message: string): never {
  throw new SubmitWritingSubmissionError(message, SubmitWritingSubmissionErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildMessages(
  task: WritingTask,
  submittedText: string,
  wordCount: number,
): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    taskTitle: task.title,
    taskInstructions: task.instructions,
    targetLevel: task.target_level ?? '(not specified)',
    minWords: String(task.min_words),
    maxWords: String(task.max_words),
    wordCount: String(wordCount),
    submittedText,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

const RESPONSE_SCHEMA: LLMJsonSchema = {
  name: 'writing_grading',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['criteria', 'corrections', 'rewrittenText', 'summary'],
    properties: {
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterion', 'band', 'justification', 'evidenceQuotes'],
          properties: {
            criterion: { type: 'string', enum: REQUIRED_CRITERIA },
            band: { type: 'integer', description: 'Cambridge band 0-5 for this criterion.' },
            justification: { type: 'string' },
            evidenceQuotes: {
              type: 'array',
              items: { type: 'string' },
              description: '1-3 short quotes copied verbatim from the submitted text.',
            },
          },
        },
      },
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['originalExcerpt', 'correctedExcerpt', 'explanation', 'category'],
          properties: {
            originalExcerpt: { type: 'string' },
            correctedExcerpt: { type: 'string' },
            explanation: { type: 'string' },
            category: {
              type: 'string',
              enum: ['grammar', 'vocabulary', 'spelling', 'punctuation', 'register', 'other'],
            },
          },
        },
      },
      rewrittenText: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new SubmitWritingSubmissionError(
    message,
    SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE,
  );
}

function validateText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') invalidResponse(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') invalidResponse(`${field} must not be empty`);
  if (trimmed.length > maxLength) invalidResponse(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

/** Whitespace/case-tolerant substring check — never trusts a quote/excerpt without verifying it against the real submitted text. */
function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function verifiesAgainst(candidate: string, submittedText: string): boolean {
  const normalizedCandidate = normalizeForMatch(candidate);
  if (normalizedCandidate === '') return false;
  return normalizeForMatch(submittedText).includes(normalizedCandidate);
}

function validateCriteria(value: unknown, submittedText: string): WritingCriterionFeedback[] {
  if (!Array.isArray(value)) invalidResponse('criteria must be an array');
  if (value.length !== REQUIRED_CRITERIA.length) {
    invalidResponse(`criteria must contain exactly ${REQUIRED_CRITERIA.length} entries`);
  }

  const seen = new Set<string>();
  const entries = value.map((raw, index): WritingCriterionFeedback => {
    if (!isPlainObject(raw)) invalidResponse(`criteria[${index}] must be an object`);

    const criterion = raw.criterion;
    if (
      typeof criterion !== 'string' ||
      !REQUIRED_CRITERIA.includes(criterion as (typeof REQUIRED_CRITERIA)[number])
    ) {
      invalidResponse(
        `criteria[${index}].criterion must be one of ${REQUIRED_CRITERIA.join(', ')}`,
      );
    }
    if (seen.has(criterion))
      invalidResponse(`criterion "${criterion}" was returned more than once`);
    seen.add(criterion);

    const band = raw.band;
    if (typeof band !== 'number' || !Number.isInteger(band) || band < 0 || band > 5) {
      invalidResponse(`criteria[${index}].band must be an integer between 0 and 5`);
    }

    const justification = validateText(
      raw.justification,
      `criteria[${index}].justification`,
      JUSTIFICATION_MAX_LENGTH,
    );

    if (!Array.isArray(raw.evidenceQuotes)) {
      invalidResponse(`criteria[${index}].evidenceQuotes must be an array`);
    }
    // Soft requirement: a quote that doesn't verify as a real substring of
    // the submitted text is dropped, not treated as a reason to fail the
    // whole (expensive) grading call — the criterion's band/justification
    // still stand on their own.
    const evidenceQuotes = (raw.evidenceQuotes as unknown[])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim().slice(0, EVIDENCE_QUOTE_MAX_LENGTH))
      .filter((q) => verifiesAgainst(q, submittedText))
      .slice(0, 3);

    return {
      criterion: criterion as WritingCriterionFeedback['criterion'],
      band,
      justification,
      evidenceQuotes,
    };
  });

  for (const required of REQUIRED_CRITERIA) {
    if (!seen.has(required)) invalidResponse(`criteria is missing the "${required}" entry`);
  }

  return entries;
}

/**
 * Same graceful-degradation policy as evidenceQuotes: a correction whose
 * originalExcerpt doesn't verify as a real substring of the submitted text
 * is dropped from the list rather than failing the whole grading call.
 */
function validateCorrections(value: unknown, submittedText: string): WritingCorrection[] {
  if (!Array.isArray(value)) invalidResponse('corrections must be an array');
  if (value.length > MAX_RAW_CORRECTIONS) {
    invalidResponse(`corrections must contain at most ${MAX_RAW_CORRECTIONS} entries`);
  }

  const valid: Omit<WritingCorrection, 'id'>[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw)) continue;
    if (typeof raw.originalExcerpt !== 'string' || typeof raw.correctedExcerpt !== 'string') {
      continue;
    }
    const originalExcerpt = raw.originalExcerpt.trim().slice(0, EXCERPT_MAX_LENGTH);
    const correctedExcerpt = raw.correctedExcerpt.trim().slice(0, EXCERPT_MAX_LENGTH);
    if (originalExcerpt === '' || correctedExcerpt === '') continue;
    if (!verifiesAgainst(originalExcerpt, submittedText)) continue;

    const explanation =
      typeof raw.explanation === 'string'
        ? raw.explanation.trim().slice(0, EXPLANATION_MAX_LENGTH)
        : '';
    if (explanation === '') continue;

    const category: WritingCorrectionCategory = VALID_CORRECTION_CATEGORIES.has(
      raw.category as string,
    )
      ? (raw.category as WritingCorrectionCategory)
      : 'other';

    valid.push({ originalExcerpt, correctedExcerpt, explanation, category });
    if (valid.length >= MAX_CORRECTIONS) break;
  }

  return valid.map((correction, index) => ({ ...correction, id: String(index) }));
}

function validateGradingResponse(value: unknown, submittedText: string): WritingFeedback {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');

  const criteria = validateCriteria(value.criteria, submittedText);
  const corrections = validateCorrections(value.corrections, submittedText);
  const rewrittenText = validateText(
    value.rewrittenText,
    'rewrittenText',
    REWRITTEN_TEXT_MAX_LENGTH,
  );
  const summary = validateText(value.summary, 'summary', SUMMARY_MAX_LENGTH);

  // Never trusted from the model's own arithmetic — computed here, always
  // the sum of the 4 criteria bands (out of 20), matching real FCE Writing
  // marking.
  const overallBand = criteria.reduce((sum, c) => sum + c.band, 0);

  return {
    version: 'writing-feedback-v1',
    criteria,
    overallBand,
    maxBand: 20,
    corrections,
    rewrittenText,
    summary,
  };
}

function mapLLMError(error: unknown): SubmitWritingSubmissionError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new SubmitWritingSubmissionError(
          'The AI provider is not configured correctly',
          SubmitWritingSubmissionErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new SubmitWritingSubmissionError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          SubmitWritingSubmissionErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new SubmitWritingSubmissionError(
          'The AI provider took too long to respond',
          SubmitWritingSubmissionErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new SubmitWritingSubmissionError(
          'The AI provider is currently unavailable',
          SubmitWritingSubmissionErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new SubmitWritingSubmissionError(
          'The AI provider returned an invalid response',
          SubmitWritingSubmissionErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new SubmitWritingSubmissionError(
    'The AI provider returned an unexpected error',
    SubmitWritingSubmissionErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/**
 * Grades and persists a writing submission. Deliberately NOT shaped like
 * SubmitPracticeAttemptService (which grades inside its DB transaction,
 * safe there because its grading is pure local computation): grading here
 * is an LLM network call, and the house rule from
 * GeneratePracticeExerciseService applies — the LLM call always happens
 * before any DB transaction opens, never hold a transaction across network
 * I/O. Shape instead: load (no lock) -> validate status -> call the LLM
 * outside any transaction -> open a transaction, re-fetch-for-update,
 * re-check status (guards a concurrent double-submit racing the LLM call)
 * -> persist.
 */
export class SubmitWritingSubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SubmitWritingSubmissionServiceDeps,
  ) {}

  async execute(
    userId: string,
    submissionId: string,
    submittedText: unknown,
    submittedAt: Date,
  ): Promise<WritingSubmissionSubmitResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(submissionId)) invalidInput('submissionId is required');
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      invalidInput('submittedAt must be a valid Date');
    }
    if (typeof submittedText !== 'string' || submittedText.trim() === '') {
      invalidInput('submittedText is required');
    }
    if (submittedText.length > SUBMITTED_TEXT_MAX_LENGTH) {
      invalidInput(`submittedText exceeds ${SUBMITTED_TEXT_MAX_LENGTH} characters`);
    }
    const cleanText = submittedText.trim();

    const submissionsFactory = this.deps.writingSubmissions ?? DEFAULT_WRITING_SUBMISSIONS_FACTORY;
    const tasksFactory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;

    const submission = await submissionsFactory(this.dataSource).findByIdForUser(
      submissionId,
      userId,
    );
    if (submission === null) {
      throw new SubmitWritingSubmissionError(
        'Writing submission not found',
        SubmitWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND,
      );
    }

    if (submission.status === WritingSubmissionStatus.GRADED) {
      // Idempotent replay: nothing is recomputed or re-graded.
      return { result: buildWritingSubmissionResultDto(submission), idempotentReplay: true };
    }
    if (submission.status === WritingSubmissionStatus.ABANDONED) {
      throw new SubmitWritingSubmissionError(
        'This writing submission was abandoned and cannot be submitted',
        SubmitWritingSubmissionErrorCode.SUBMISSION_ABANDONED,
      );
    }

    const task = await tasksFactory(this.dataSource).findByIdForUser(submission.task_id, userId);
    if (task === null) {
      throw new SubmitWritingSubmissionError(
        'Failed to load the writing task for grading',
        SubmitWritingSubmissionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const wordCount = countWords(cleanText);
    const messages = buildMessages(task, cleanText, wordCount);

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

    const feedback = validateGradingResponse(raw, cleanText);
    const durationSeconds = Math.max(
      0,
      Math.floor((submittedAt.getTime() - submission.started_at.getTime()) / 1000),
    );

    return this.dataSource.transaction(async (manager) => {
      const locked = await submissionsFactory(manager).findByIdForUpdate(
        submissionId,
        userId,
        manager,
      );
      if (locked === null) {
        throw new SubmitWritingSubmissionError(
          'Writing submission not found',
          SubmitWritingSubmissionErrorCode.SUBMISSION_NOT_FOUND,
        );
      }
      if (locked.status === WritingSubmissionStatus.GRADED) {
        // Lost a race against a concurrent submit — discard this (already
        // paid for) grading result and replay whichever one actually won.
        return { result: buildWritingSubmissionResultDto(locked), idempotentReplay: true };
      }
      if (locked.status === WritingSubmissionStatus.ABANDONED) {
        throw new SubmitWritingSubmissionError(
          'This writing submission was abandoned and cannot be submitted',
          SubmitWritingSubmissionErrorCode.SUBMISSION_ABANDONED,
        );
      }

      const gradeData: GradeSubmissionData = {
        submittedAt,
        durationSeconds,
        submittedText: cleanText,
        wordCount,
        feedback,
      };
      const updateResult = await submissionsFactory(manager).gradeSubmission(
        submissionId,
        userId,
        gradeData,
        manager,
      );
      if (updateResult.affected !== 1) {
        throw new SubmitWritingSubmissionError(
          'Failed to persist the graded writing submission',
          SubmitWritingSubmissionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }

      const gradedSubmission = {
        ...locked,
        status: WritingSubmissionStatus.GRADED,
        submitted_at: submittedAt,
        duration_seconds: durationSeconds,
        submitted_text: cleanText,
        word_count: wordCount,
        feedback,
      } as WritingSubmission;

      return {
        result: buildWritingSubmissionResultDto(gradedSubmission),
        idempotentReplay: false,
      };
    });
  }
}
