import { LLMServiceError, LLMErrorCode } from '../../services/llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../../services/llm/llm.types';
import type { WritingTask } from '../../models/WritingTask';
import type {
  WritingCorrection,
  WritingCorrectionCategory,
  WritingCriterionFeedback,
  WritingFeedback,
} from '../../models/writing-json-types';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { getWritingTaskFormat } from './writing-task-catalog';
import SYSTEM_PROMPT from '../../prompts/writing/grade-submission.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/writing/grade-submission.user.md';

/**
 * The LLM-grading core shared by SubmitWritingSubmissionService (standalone
 * Writing practice) and SubmitMockAttemptSectionService (a Writing section
 * inside a timed full mock) — extracted so both callers grade against the
 * exact same rubric/schema/validation instead of drifting. Deliberately has
 * no persistence/transaction concerns of its own; each caller owns that.
 */

export interface WritingGradingLLMPort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

export enum WritingGradingErrorCode {
  AI_CONFIGURATION_ERROR = 'ai_configuration_error',
  AI_PROVIDER_UNAVAILABLE = 'ai_provider_unavailable',
  AI_INVALID_RESPONSE = 'ai_invalid_response',
  AI_REQUEST_TIMEOUT = 'ai_request_timeout',
  AI_RATE_LIMITED = 'ai_rate_limited',
}

export class WritingGradingError extends Error {
  constructor(
    message: string,
    readonly code: WritingGradingErrorCode,
  ) {
    super(message);
    this.name = 'WritingGradingError';
  }
}

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

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function buildWritingGradingMessages(
  task: WritingTask,
  submittedText: string,
  wordCount: number,
): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    part: `Part ${getWritingTaskFormat(task.task_type).part}`,
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

export const WRITING_GRADING_RESPONSE_SCHEMA: LLMJsonSchema = {
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
  throw new WritingGradingError(message, WritingGradingErrorCode.AI_INVALID_RESPONSE);
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

export function validateWritingGradingResponse(
  value: unknown,
  submittedText: string,
): WritingFeedback {
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

export function mapWritingGradingLLMError(error: unknown): WritingGradingError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new WritingGradingError(
          'The AI provider is not configured correctly',
          WritingGradingErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new WritingGradingError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          WritingGradingErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new WritingGradingError(
          'The AI provider took too long to respond',
          WritingGradingErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new WritingGradingError(
          'The AI provider is currently unavailable',
          WritingGradingErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new WritingGradingError(
          'The AI provider returned an invalid response',
          WritingGradingErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new WritingGradingError(
    'The AI provider returned an unexpected error',
    WritingGradingErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/** Grades one submitted text against one task. Pure orchestration over the LLM — no persistence. */
export async function gradeWritingSubmission(
  llm: WritingGradingLLMPort,
  task: WritingTask,
  submittedText: string,
): Promise<{ feedback: WritingFeedback; wordCount: number }> {
  if (submittedText.length > SUBMITTED_TEXT_MAX_LENGTH) {
    invalidResponse(`submittedText exceeds ${SUBMITTED_TEXT_MAX_LENGTH} characters`);
  }
  const wordCount = countWords(submittedText);
  const messages = buildWritingGradingMessages(task, submittedText, wordCount);

  let raw: unknown;
  try {
    raw = await llm.completeStructured(messages, {
      responseSchema: WRITING_GRADING_RESPONSE_SCHEMA,
      timeoutMs: REQUEST_TIMEOUT_MS,
      temperature: RESPONSE_TEMPERATURE,
      maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
    });
  } catch (err: unknown) {
    throw mapWritingGradingLLMError(err);
  }

  const feedback = validateWritingGradingResponse(raw, submittedText);
  return { feedback, wordCount };
}
