/// <reference path="../../types/markdown.d.ts" />
import type { DataSource, EntityManager } from 'typeorm';
import { DailySessionSubmissionStatus } from '../../models/enums';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import type {
  DailySessionAnswerPayload,
  DailySessionComprehensionAnswerRecord,
  DailySessionSentenceFeedback,
  DailySessionSentenceFeedbackItem,
  DailySessionSentenceTarget,
} from '../../models/daily-session-json-types';
import type { DailySessionItem } from '../../models/DailySessionItem';
import type { DailySessionSubmission } from '../../models/DailySessionSubmission';
import type {
  SentenceSubmissionRequest,
  DailySessionSubmissionSubmitResultDto,
} from '../../interfaces/daily-session/daily-session.interface';
import { isDailySessionAnswerPayload } from '@lib/daily-session/daily-session-jsonb-validators';
import { gradeItem, roundToTwoDecimals } from '@lib/daily-session/daily-session-grading';
import { buildDailySessionSubmissionResultDto } from '@lib/daily-session/daily-session-submission-dto';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import { DailySessionsRepository } from '@repositories/daily-session/daily-sessions.repository';
import type { DailySessionWithAnswerKeysForEvaluation } from '@repositories/daily-session/daily-sessions.repository';
import { DailySessionSubmissionsRepository } from '@repositories/daily-session/daily-session-submissions.repository';
import type { GradeSubmissionData } from '@repositories/daily-session/daily-session-submissions.repository';
import { createAiLinkedPlannedActivity } from '../planning/create-ai-linked-activity';
import type { CreateAiLinkedPlannedActivityInput } from '../planning/create-ai-linked-activity';
import { resolvePlanDayIdForDate } from '../planning/resolve-plan-day-for-date';
import SYSTEM_PROMPT from '../../prompts/daily-session/grade-sentences.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/daily-session/grade-sentences.user.md';

export enum SubmitDailySessionSubmissionErrorCode {
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

export class SubmitDailySessionSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: SubmitDailySessionSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'SubmitDailySessionSubmissionError';
  }
}

export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

type RepositorySource = DataSource | EntityManager;

export interface DailySessionsRepositoryPort {
  findSessionWithAnswerKeysForEvaluation(
    sessionId: string,
    userId: string,
  ): Promise<DailySessionWithAnswerKeysForEvaluation | null>;
}

export interface DailySessionSubmissionsRepositoryPort {
  findByIdForUser(submissionId: string, userId: string): Promise<DailySessionSubmission | null>;
  findByIdForUpdate(
    submissionId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<DailySessionSubmission | null>;
  gradeSubmission(
    submissionId: string,
    userId: string,
    data: GradeSubmissionData,
    manager: EntityManager,
  ): Promise<{ affected?: number | null }>;
}

export interface SubmitDailySessionSubmissionServiceDeps {
  llm: LLMServicePort;
  dailySessions?: (source: RepositorySource) => DailySessionsRepositoryPort;
  dailySessionSubmissions?: (source: RepositorySource) => DailySessionSubmissionsRepositoryPort;
  // Injectable seam for tests — see SubmitWritingSubmissionServiceDeps.createAiLinkedActivity.
  createAiLinkedActivity?: (
    manager: EntityManager,
    input: CreateAiLinkedPlannedActivityInput,
  ) => Promise<unknown>;
  resolvePlanDayId?: (manager: EntityManager, userId: string, dateKey: string) => Promise<string>;
}

const DEFAULT_DAILY_SESSIONS_FACTORY = (source: RepositorySource): DailySessionsRepositoryPort =>
  new DailySessionsRepository(source);
const DEFAULT_DAILY_SESSION_SUBMISSIONS_FACTORY = (
  source: RepositorySource,
): DailySessionSubmissionsRepositoryPort => new DailySessionSubmissionsRepository(source);

const REQUEST_TIMEOUT_MS = 30_000;
const RESPONSE_TEMPERATURE = 0.3;
const RESPONSE_MAX_OUTPUT_TOKENS = 2000;

const SENTENCE_MAX_LENGTH = 300;
const FEEDBACK_MAX_LENGTH = 500;
const CORRECTED_SENTENCE_MAX_LENGTH = 300;
const EVIDENCE_QUOTE_MAX_LENGTH = 300;

function invalidInput(message: string): never {
  throw new SubmitDailySessionSubmissionError(
    message,
    SubmitDailySessionSubmissionErrorCode.INVALID_INPUT,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Shape-only validation, mirroring SubmitPracticeAttemptService's
 * validateAnswersShape — cross-referencing against the real item set
 * happens once the session is fetched. Any item omitted from the request
 * becomes 'unanswered', same lenience as Practice.
 */
function validateComprehensionAnswersShape(
  answers: unknown,
): { itemId: string; answer: DailySessionAnswerPayload }[] {
  if (!Array.isArray(answers)) invalidInput('comprehensionAnswers must be an array');

  return answers.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      invalidInput(`comprehensionAnswers[${index}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;

    if (!isNonEmptyString(entry.itemId)) {
      invalidInput(`comprehensionAnswers[${index}].itemId is required`);
    }
    if (!isDailySessionAnswerPayload(entry.answerPayload)) {
      invalidInput(`comprehensionAnswers[${index}].answerPayload has an invalid shape`);
    }

    return { itemId: entry.itemId, answer: toCleanPayload(entry.answerPayload) };
  });
}

/** Strips any extra client-supplied properties (e.g. a spoofed `isCorrect`) — only the fields the kind actually needs survive. */
function toCleanPayload(payload: DailySessionAnswerPayload): DailySessionAnswerPayload {
  if (payload.kind === 'single_choice')
    return { kind: 'single_choice', optionId: payload.optionId };
  if (payload.kind === 'text') return { kind: 'text', value: payload.value };
  return { kind: 'unanswered' };
}

interface ValidatedSentenceSubmission {
  target: DailySessionSentenceTarget;
  submittedSentence: string;
}

function validateSentenceSubmissions(
  raw: unknown,
  targets: DailySessionSentenceTarget[],
): ValidatedSentenceSubmission[] {
  if (!Array.isArray(raw)) invalidInput('sentenceSubmissions must be an array');
  if (raw.length !== targets.length) {
    invalidInput(`sentenceSubmissions must contain exactly ${targets.length} entries`);
  }

  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const seen = new Set<string>();

  return raw.map((entry, index): ValidatedSentenceSubmission => {
    if (typeof entry !== 'object' || entry === null) {
      invalidInput(`sentenceSubmissions[${index}] must be an object`);
    }
    const { targetId, submittedSentence } = entry as SentenceSubmissionRequest;

    if (!isNonEmptyString(targetId) || !targetsById.has(targetId)) {
      invalidInput(`sentenceSubmissions[${index}].targetId does not match a real target`);
    }
    if (seen.has(targetId)) invalidInput(`duplicate sentenceSubmission for target ${targetId}`);
    seen.add(targetId);

    if (!isNonEmptyString(submittedSentence)) {
      invalidInput(`sentenceSubmissions[${index}].submittedSentence is required`);
    }
    if (submittedSentence.length > SENTENCE_MAX_LENGTH) {
      invalidInput(
        `sentenceSubmissions[${index}].submittedSentence exceeds ${SENTENCE_MAX_LENGTH} characters`,
      );
    }

    // Non-null: targetsById.has(targetId) was already checked above.
    const target = targetsById.get(targetId) as DailySessionSentenceTarget;
    return { target, submittedSentence: submittedSentence.trim() };
  });
}

function buildMessages(
  targetLevel: string,
  submissions: ValidatedSentenceSubmission[],
): LLMChatMessage[] {
  const targetsWithSentences = submissions
    .map(
      (s, index) =>
        `${index + 1}. Target: "${s.target.targetText}" (${s.target.hint})\n   Student's sentence: "${s.submittedSentence}"`,
    )
    .join('\n\n');

  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    targetLevel,
    targetsWithSentences,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

const RESPONSE_SCHEMA: LLMJsonSchema = {
  name: 'daily_session_sentence_grading',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'targetIndex',
            'usesTargetCorrectly',
            'feedback',
            'correctedSentence',
            'evidenceQuote',
          ],
          properties: {
            targetIndex: {
              type: 'integer',
              description: '1-based index matching the numbered target in the prompt.',
            },
            usesTargetCorrectly: { type: 'boolean' },
            feedback: { type: 'string' },
            correctedSentence: { type: ['string', 'null'] },
            evidenceQuote: {
              type: ['string', 'null'],
              description: "Copied verbatim from that target's own submitted sentence, or null.",
            },
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
  throw new SubmitDailySessionSubmissionError(
    message,
    SubmitDailySessionSubmissionErrorCode.AI_INVALID_RESPONSE,
  );
}

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Whitespace/case-tolerant substring check — never trusts a quote without verifying it against that target's own submitted sentence. */
function verifiesAgainst(candidate: string, submittedSentence: string): boolean {
  const normalizedCandidate = normalizeForMatch(candidate);
  if (normalizedCandidate === '') return false;
  return normalizeForMatch(submittedSentence).includes(normalizedCandidate);
}

function validateGradingResponse(
  value: unknown,
  submissions: ValidatedSentenceSubmission[],
): DailySessionSentenceFeedback {
  if (!isPlainObject(value)) invalidResponse('response must be a JSON object');
  if (!Array.isArray(value.items)) invalidResponse('items must be an array');
  if (value.items.length !== submissions.length) {
    invalidResponse(`items must contain exactly ${submissions.length} entries`);
  }

  const seenIndexes = new Set<number>();
  const items: DailySessionSentenceFeedbackItem[] = value.items.map((raw, arrayIndex) => {
    if (!isPlainObject(raw)) invalidResponse(`items[${arrayIndex}] must be an object`);

    const targetIndex = raw.targetIndex;
    if (
      typeof targetIndex !== 'number' ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 1 ||
      targetIndex > submissions.length
    ) {
      invalidResponse(`items[${arrayIndex}].targetIndex is out of range`);
    }
    if (seenIndexes.has(targetIndex)) {
      invalidResponse(`targetIndex ${targetIndex} was returned more than once`);
    }
    seenIndexes.add(targetIndex);

    const submission = submissions[targetIndex - 1];

    if (typeof raw.usesTargetCorrectly !== 'boolean') {
      invalidResponse(`items[${arrayIndex}].usesTargetCorrectly must be a boolean`);
    }

    const feedback =
      typeof raw.feedback === 'string' && raw.feedback.trim() !== ''
        ? raw.feedback.trim().slice(0, FEEDBACK_MAX_LENGTH)
        : invalidResponse(`items[${arrayIndex}].feedback must be a non-empty string`);

    const correctedSentence =
      typeof raw.correctedSentence === 'string' && raw.correctedSentence.trim() !== ''
        ? raw.correctedSentence.trim().slice(0, CORRECTED_SENTENCE_MAX_LENGTH)
        : null;

    // Soft requirement, same graceful-degradation policy as Writing's
    // evidenceQuotes: a quote that doesn't verify as a real substring of
    // THAT target's own submitted sentence is dropped, not a hard failure.
    const rawQuote = typeof raw.evidenceQuote === 'string' ? raw.evidenceQuote.trim() : '';
    const evidenceQuote =
      rawQuote !== '' &&
      rawQuote.length <= EVIDENCE_QUOTE_MAX_LENGTH &&
      verifiesAgainst(rawQuote, submission.submittedSentence)
        ? rawQuote
        : null;

    return {
      targetId: submission.target.id,
      usesTargetCorrectly: raw.usesTargetCorrectly,
      feedback,
      correctedSentence,
      evidenceQuote,
    };
  });

  for (let i = 1; i <= submissions.length; i++) {
    if (!seenIndexes.has(i)) invalidResponse(`response is missing targetIndex ${i}`);
  }

  // Never trusted from the model's own count — always computed here.
  const correctCount = items.filter((item) => item.usesTargetCorrectly).length;

  return {
    version: 'daily-session-sentence-feedback-v1',
    items,
    correctCount,
    totalCount: submissions.length,
  };
}

function mapLLMError(error: unknown): SubmitDailySessionSubmissionError {
  if (error instanceof LLMServiceError) {
    switch (error.code) {
      case LLMErrorCode.NOT_CONFIGURED:
      case LLMErrorCode.AUTHENTICATION_FAILED:
        return new SubmitDailySessionSubmissionError(
          'The AI provider is not configured correctly',
          SubmitDailySessionSubmissionErrorCode.AI_CONFIGURATION_ERROR,
        );
      case LLMErrorCode.RATE_LIMITED:
        return new SubmitDailySessionSubmissionError(
          'The AI provider is rate-limiting requests. Try again shortly.',
          SubmitDailySessionSubmissionErrorCode.AI_RATE_LIMITED,
        );
      case LLMErrorCode.TIMEOUT:
        return new SubmitDailySessionSubmissionError(
          'The AI provider took too long to respond',
          SubmitDailySessionSubmissionErrorCode.AI_REQUEST_TIMEOUT,
        );
      case LLMErrorCode.PROVIDER_ERROR:
        return new SubmitDailySessionSubmissionError(
          'The AI provider is currently unavailable',
          SubmitDailySessionSubmissionErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      case LLMErrorCode.EMPTY_RESPONSE:
      case LLMErrorCode.INVALID_JSON_RESPONSE:
      case LLMErrorCode.INVALID_INPUT:
        return new SubmitDailySessionSubmissionError(
          'The AI provider returned an invalid response',
          SubmitDailySessionSubmissionErrorCode.AI_INVALID_RESPONSE,
        );
    }
  }
  return new SubmitDailySessionSubmissionError(
    'The AI provider returned an unexpected error',
    SubmitDailySessionSubmissionErrorCode.AI_PROVIDER_UNAVAILABLE,
  );
}

/**
 * Grades a Daily Session submission: comprehension deterministically (pure
 * code, no LLM — mirrors SubmitPracticeAttemptService), the sentence task via
 * one LLM call (mirrors SubmitWritingSubmissionService exactly). Deliberately
 * NOT shaped like SubmitPracticeAttemptService as a whole, because the
 * sentence half is a network call — the house rule applies: the LLM call
 * always happens before any DB transaction opens, never hold a transaction
 * across network I/O. Shape: load (no lock) -> validate status -> grade
 * comprehension (pure) -> call the LLM outside any transaction -> open a
 * transaction, re-fetch-for-update, re-check status (guards a concurrent
 * double-submit racing the LLM call) -> persist -> register on the plan.
 */
export class SubmitDailySessionSubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SubmitDailySessionSubmissionServiceDeps,
  ) {}

  async execute(
    userId: string,
    submissionId: string,
    input: { comprehensionAnswers: unknown; sentenceSubmissions: unknown },
    submittedAt: Date,
  ): Promise<DailySessionSubmissionSubmitResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(submissionId)) invalidInput('submissionId is required');
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      invalidInput('submittedAt must be a valid Date');
    }
    const comprehensionAnswers = validateComprehensionAnswersShape(input.comprehensionAnswers);

    const submissionsFactory =
      this.deps.dailySessionSubmissions ?? DEFAULT_DAILY_SESSION_SUBMISSIONS_FACTORY;
    const sessionsFactory = this.deps.dailySessions ?? DEFAULT_DAILY_SESSIONS_FACTORY;

    const submission = await submissionsFactory(this.dataSource).findByIdForUser(
      submissionId,
      userId,
    );
    if (submission === null) {
      throw new SubmitDailySessionSubmissionError(
        'Daily session submission not found',
        SubmitDailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND,
      );
    }
    if (submission.status === DailySessionSubmissionStatus.GRADED) {
      // Idempotent replay: nothing is recomputed or re-graded.
      return { result: buildDailySessionSubmissionResultDto(submission), idempotentReplay: true };
    }
    if (submission.status === DailySessionSubmissionStatus.ABANDONED) {
      throw new SubmitDailySessionSubmissionError(
        'This daily session submission was abandoned and cannot be submitted',
        SubmitDailySessionSubmissionErrorCode.SUBMISSION_ABANDONED,
      );
    }

    const withKeys = await sessionsFactory(this.dataSource).findSessionWithAnswerKeysForEvaluation(
      submission.daily_session_id,
      userId,
    );
    if (withKeys === null) {
      throw new SubmitDailySessionSubmissionError(
        'Failed to load the session answer keys for grading',
        SubmitDailySessionSubmissionErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    const { session, items } = withKeys;

    // ── Comprehension: pure, deterministic, no LLM ─────────────────────────

    const itemsById = new Map(items.map((item) => [item.id, item]));
    const submittedByItemId = new Map<
      string,
      { itemId: string; answer: DailySessionAnswerPayload }
    >();
    for (const answer of comprehensionAnswers) {
      if (submittedByItemId.has(answer.itemId)) {
        invalidInput(`duplicate answer submitted for item ${answer.itemId}`);
      }
      if (!itemsById.has(answer.itemId)) {
        invalidInput(`item ${answer.itemId} does not belong to this session`);
      }
      submittedByItemId.set(answer.itemId, answer);
    }

    const gradedRecords: DailySessionComprehensionAnswerRecord[] = items.map(
      (item: DailySessionItem) => {
        const submitted = submittedByItemId.get(item.id);
        const payload: DailySessionAnswerPayload = submitted?.answer ?? { kind: 'unanswered' };
        const graded = gradeItem(item.answer_key, payload);
        return {
          itemId: item.id,
          answerPayload: payload,
          normalizedAnswer: graded.normalizedAnswer,
          isCorrect: graded.isCorrect,
        };
      },
    );
    const comprehensionTotalCount = items.length;
    const comprehensionCorrectCount = gradedRecords.filter((r) => r.isCorrect).length;
    const comprehensionPercentage = roundToTwoDecimals(
      (comprehensionCorrectCount / comprehensionTotalCount) * 100,
    );

    // ── Sentence task: one LLM call, outside any transaction ───────────────

    const validatedSentences = validateSentenceSubmissions(
      input.sentenceSubmissions,
      session.sentence_targets,
    );
    const messages = buildMessages(session.target_level ?? '(not specified)', validatedSentences);

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

    const sentenceFeedback = validateGradingResponse(raw, validatedSentences);
    const sentenceSubmissionRecords = validatedSentences.map((s) => ({
      targetId: s.target.id,
      submittedSentence: s.submittedSentence,
    }));

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
        throw new SubmitDailySessionSubmissionError(
          'Daily session submission not found',
          SubmitDailySessionSubmissionErrorCode.SUBMISSION_NOT_FOUND,
        );
      }
      if (locked.status === DailySessionSubmissionStatus.GRADED) {
        // Lost a race against a concurrent submit — discard this (already
        // paid for) grading result and replay whichever one actually won.
        return { result: buildDailySessionSubmissionResultDto(locked), idempotentReplay: true };
      }
      if (locked.status === DailySessionSubmissionStatus.ABANDONED) {
        throw new SubmitDailySessionSubmissionError(
          'This daily session submission was abandoned and cannot be submitted',
          SubmitDailySessionSubmissionErrorCode.SUBMISSION_ABANDONED,
        );
      }

      const gradeData: GradeSubmissionData = {
        submittedAt,
        durationSeconds,
        comprehensionAnswers: gradedRecords,
        comprehensionCorrectCount,
        comprehensionTotalCount,
        comprehensionPercentage,
        sentenceSubmissions: sentenceSubmissionRecords,
        sentenceFeedback,
      };
      const updateResult = await submissionsFactory(manager).gradeSubmission(
        submissionId,
        userId,
        gradeData,
        manager,
      );
      if (updateResult.affected !== 1) {
        throw new SubmitDailySessionSubmissionError(
          'Failed to persist the graded daily session submission',
          SubmitDailySessionSubmissionErrorCode.PERSISTENCE_INCONSISTENCY,
        );
      }

      // Register on the Plan/Home only once the submission is really graded
      // — never at start time. Unlike Practice/Writing there is no captured
      // plan_day_id — a Daily Session always registers against the day it's
      // FOR (session.session_date), resolved fresh here every time.
      {
        const linker = this.deps.createAiLinkedActivity ?? createAiLinkedPlannedActivity;
        const resolveDay = this.deps.resolvePlanDayId ?? resolvePlanDayIdForDate;
        const planDayId = await resolveDay(manager, userId, session.session_date);
        await linker(manager, {
          planDayId,
          title: `Daily Session — ${session.reading_title}`,
          skillSlug: 'reading',
          examSectionSlug: 'reading-part-5',
          estimatedDurationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
          completedAt: submittedAt,
          dailySessionSubmissionId: submissionId,
        });
      }

      const gradedSubmission = {
        ...locked,
        status: DailySessionSubmissionStatus.GRADED,
        submitted_at: submittedAt,
        duration_seconds: durationSeconds,
        comprehension_answers: gradedRecords,
        comprehension_correct_count: comprehensionCorrectCount,
        comprehension_total_count: comprehensionTotalCount,
        comprehension_percentage: String(comprehensionPercentage),
        sentence_submissions: sentenceSubmissionRecords,
        sentence_feedback: sentenceFeedback,
      } as DailySessionSubmission;

      return {
        result: buildDailySessionSubmissionResultDto(gradedSubmission),
        idempotentReplay: false,
      };
    });
  }
}
