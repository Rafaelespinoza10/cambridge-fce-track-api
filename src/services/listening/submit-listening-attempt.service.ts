import type { DataSource, EntityManager } from 'typeorm';
import type { ListeningAttempt } from '@models/ListeningAttempt';
import type { ListeningItem } from '@models/ListeningItem';
import { ListeningAttemptStatus } from '@models/enums';
import type { CompleteListeningAttemptData } from '@repositories/listening/listening-attempts.repository';
import type { ListeningAttemptAnswerEntry } from '@models/listening-json-types';
import {
  gradeItem,
  roundToTwoDecimals,
  computeFeedbackSummary,
  buildListeningAttemptResultDto,
} from '@lib/listening/listening-attempt-grading';
import { isPracticeAnswerPayload } from '@lib/practice/practice-jsonb-validators';
import type { PracticeAnswerPayload } from '@models/practice-json-types';
import type {
  SubmitListeningAttemptAnswerInput,
  ListeningAttemptSubmitResultDto,
} from '../../interfaces/listening/listening-attempt.interface';
import { createAiLinkedPlannedActivity } from '../planning/create-ai-linked-activity';
import type { CreateAiLinkedPlannedActivityInput } from '../planning/create-ai-linked-activity';
import { resolvePlanDayIdForDate } from '../planning/resolve-plan-day-for-date';
import { resolveUserLocalDayKey } from '../planning/resolve-user-local-day';

export enum SubmitListeningAttemptErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class SubmitListeningAttemptError extends Error {
  constructor(
    message: string,
    readonly code: SubmitListeningAttemptErrorCode,
  ) {
    super(message);
    this.name = 'SubmitListeningAttemptError';
  }
}

export interface ListeningAttemptsRepositoryPort {
  findByIdForUser(attemptId: string, userId: string): Promise<ListeningAttempt | null>;
  /**
   * Locks the row with SELECT ... FOR UPDATE — requires a transactional
   * EntityManager. Guards a concurrent double-submit racing the deterministic
   * grader the same way Writing/Practice guard their (slower) LLM call.
   */
  findByIdForUpdate(
    attemptId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<ListeningAttempt | null>;
  completeAttempt(
    attemptId: string,
    userId: string,
    data: CompleteListeningAttemptData,
    manager: EntityManager,
  ): Promise<{ affected?: number | null }>;
}

export interface ListeningSourcesRepositoryPort {
  findItemsWithAnswerKeysBySourceId(sourceId: string): Promise<ListeningItem[]>;
  findTitleAndPartCodeById(
    sourceId: string,
  ): Promise<{ title: string; partCode: string } | null>;
}

export interface SubmitListeningAttemptServiceDeps {
  attempts: ListeningAttemptsRepositoryPort;
  sources: ListeningSourcesRepositoryPort;
  // Injectable seam for tests — see SubmitWritingSubmissionServiceDeps.createAiLinkedActivity.
  createAiLinkedActivity?: (
    manager: EntityManager,
    input: CreateAiLinkedPlannedActivityInput,
  ) => Promise<unknown>;
  // Injectable seam for tests — see resolve-plan-day-for-date.ts.
  resolvePlanDayId?: (manager: EntityManager, userId: string, dateKey: string) => Promise<string>;
  resolveUserLocalDayKey?: (
    manager: EntityManager,
    userId: string,
    instant: Date,
  ) => Promise<string>;
}

function invalidInput(message: string): never {
  throw new SubmitListeningAttemptError(message, SubmitListeningAttemptErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Shape-only validation — cross-referencing against the real item set happens once the attempt's items are fetched. */
function validateAnswersShape(answers: unknown): SubmitListeningAttemptAnswerInput[] {
  if (!Array.isArray(answers)) invalidInput('answers must be an array');

  return answers.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null)
      invalidInput(`answers[${index}] must be an object`);
    const entry = raw as Record<string, unknown>;

    if (!isNonEmptyString(entry.itemId)) invalidInput(`answers[${index}].itemId is required`);
    if (!isPracticeAnswerPayload(entry.answer)) {
      invalidInput(`answers[${index}].answer has an invalid shape`);
    }
    if (
      entry.responseTimeMs !== undefined &&
      entry.responseTimeMs !== null &&
      (typeof entry.responseTimeMs !== 'number' || entry.responseTimeMs < 0)
    ) {
      invalidInput(`answers[${index}].responseTimeMs must be null or a non-negative number`);
    }

    return {
      itemId: entry.itemId,
      // Rebuilt field-by-field (never the raw client object) — a stray
      // client-sent `isCorrect`/score alongside a valid kind must never
      // reach the persisted answer.
      answer: toCleanPayload(entry.answer),
      responseTimeMs: (entry.responseTimeMs as number | null | undefined) ?? null,
    };
  });
}

function toCleanPayload(payload: PracticeAnswerPayload): PracticeAnswerPayload {
  if (payload.kind === 'single_choice')
    return { kind: 'single_choice', optionId: payload.optionId };
  if (payload.kind === 'text') return { kind: 'text', value: payload.value };
  return { kind: 'unanswered' };
}

/** "LISTENING_PART_2" -> "listening-part-2", matching the seeded exam_sections slug. */
function examSectionSlugForPartCode(partCode: string): string | null {
  const match = /_PART_(\d+)$/.exec(partCode);
  return match ? `listening-part-${match[1]}` : null;
}

/**
 * Grades and persists a full attempt submission: validate ownership/status
 * -> fetch the real answer keys -> grade every item deterministically ->
 * lock and complete the attempt, and register it on the Plan/Home, inside
 * one transaction. Client-sent score/timestamps/isCorrect are never read;
 * only itemId/answer/responseTimeMs are.
 */
export class SubmitListeningAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SubmitListeningAttemptServiceDeps,
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    rawAnswers: unknown,
    submittedAt: Date,
  ): Promise<ListeningAttemptSubmitResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      invalidInput('submittedAt must be a valid Date');
    }
    const answers = validateAnswersShape(rawAnswers);

    const attempt = await this.deps.attempts.findByIdForUser(attemptId, userId);
    if (attempt === null) {
      throw new SubmitListeningAttemptError(
        'Listening attempt not found',
        SubmitListeningAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }

    if (attempt.status === ListeningAttemptStatus.COMPLETED) {
      // Idempotent replay: nothing is recomputed.
      return this.buildReplayResult(attempt);
    }

    const itemsWithKeys = await this.deps.sources.findItemsWithAnswerKeysBySourceId(
      attempt.source_id,
    );
    if (itemsWithKeys.length === 0) {
      throw new SubmitListeningAttemptError(
        'Failed to load the listening item answer keys for grading',
        SubmitListeningAttemptErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const itemsById = new Map(itemsWithKeys.map((item) => [item.id, item]));
    const submittedByItemId = new Map<string, SubmitListeningAttemptAnswerInput>();
    for (const answer of answers) {
      if (submittedByItemId.has(answer.itemId)) {
        invalidInput(`duplicate answer submitted for item ${answer.itemId}`);
      }
      if (!itemsById.has(answer.itemId)) {
        invalidInput(`item ${answer.itemId} does not belong to this listening source`);
      }
      submittedByItemId.set(answer.itemId, answer);
    }

    // Exactly one answer per item — any item omitted from the request becomes 'unanswered'.
    const gradedAnswers: ListeningAttemptAnswerEntry[] = itemsWithKeys.map((item) => {
      const submitted = submittedByItemId.get(item.id);
      const payload: PracticeAnswerPayload = submitted?.answer ?? { kind: 'unanswered' };
      const responseTimeMs = submitted?.responseTimeMs ?? null;
      const graded = gradeItem(item.answer_key, payload);
      return {
        itemId: item.id,
        answerPayload: payload,
        normalizedAnswer: graded.normalizedAnswer,
        isCorrect: graded.isCorrect,
        responseTimeMs,
      };
    });

    const totalCount = itemsWithKeys.length;
    const correctCount = gradedAnswers.filter((a) => a.isCorrect).length;
    const percentage = roundToTwoDecimals((correctCount / totalCount) * 100);
    const durationSeconds = Math.max(
      0,
      Math.floor((submittedAt.getTime() - attempt.started_at.getTime()) / 1000),
    );
    const feedbackSummary = computeFeedbackSummary(
      itemsWithKeys.map((item) => {
        const answer = gradedAnswers.find((a) => a.itemId === item.id);
        return {
          skillTags: item.skill_tags,
          isCorrect: answer?.isCorrect ?? false,
          isUnanswered: answer?.answerPayload.kind === 'unanswered',
        };
      }),
    );
    const listeningFeedbackSummary = {
      ...feedbackSummary,
      version: 'listening-attempt-feedback-v1' as const,
    };

    return this.dataSource.transaction(async (manager) => {
      const locked = await this.deps.attempts.findByIdForUpdate(attemptId, userId, manager);
      if (locked === null) {
        throw new SubmitListeningAttemptError(
          'Listening attempt not found',
          SubmitListeningAttemptErrorCode.ATTEMPT_NOT_FOUND,
        );
      }
      if (locked.status === ListeningAttemptStatus.COMPLETED) {
        // Lost a race against a concurrent submit — discard this (already
        // computed) grading result and replay whichever one actually won.
        return this.buildReplayResult(locked);
      }

      await this.deps.attempts.completeAttempt(
        attemptId,
        userId,
        {
          submittedAt,
          durationSeconds,
          correctCount,
          percentage,
          answers: gradedAnswers,
          feedbackSummary: listeningFeedbackSummary,
        },
        manager,
      );

      // Register on the Plan/Home only once the attempt is really completed
      // — never at start time. A standalone Listening attempt never captures
      // a plan_day_id up front (there is no "Add Activity" chooser flow into
      // it, unlike Practice/Writing), so the day is always resolved here, the
      // same way Daily Session resolves it. Without this, a finished
      // Listening session never showed up as a completed activity on the
      // Plan/Home "This Week" count the way Practice/Writing/Daily Session
      // already did.
      {
        const linker = this.deps.createAiLinkedActivity ?? createAiLinkedPlannedActivity;
        const resolveDay = this.deps.resolvePlanDayId ?? resolvePlanDayIdForDate;
        const resolveLocalDayKey = this.deps.resolveUserLocalDayKey ?? resolveUserLocalDayKey;
        const planDayId = await resolveDay(
          manager,
          userId,
          await resolveLocalDayKey(manager, userId, submittedAt),
        );
        const sourceInfo = await this.deps.sources.findTitleAndPartCodeById(attempt.source_id);
        await linker(manager, {
          planDayId,
          title: `Listening — ${sourceInfo?.title ?? 'Listening'}`,
          skillSlug: 'listening',
          examSectionSlug: sourceInfo ? examSectionSlugForPartCode(sourceInfo.partCode) : null,
          estimatedDurationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
          completedAt: submittedAt,
          listeningAttemptId: attemptId,
        });
      }

      const completedAttempt = {
        ...attempt,
        status: ListeningAttemptStatus.COMPLETED,
        submitted_at: submittedAt,
        duration_seconds: durationSeconds,
        correct_count: correctCount,
        total_count: totalCount,
        percentage: String(percentage),
        feedback_summary: listeningFeedbackSummary,
      } as ListeningAttempt;

      return {
        result: buildListeningAttemptResultDto(completedAttempt, itemsWithKeys, gradedAnswers),
        idempotentReplay: false,
      };
    });
  }

  private async buildReplayResult(
    attempt: ListeningAttempt,
  ): Promise<ListeningAttemptSubmitResultDto> {
    const itemsWithKeys = await this.deps.sources.findItemsWithAnswerKeysBySourceId(
      attempt.source_id,
    );
    if (itemsWithKeys.length === 0 || attempt.answers === null) {
      throw new SubmitListeningAttemptError(
        'Failed to load the listening item answer keys while replaying a completed submission',
        SubmitListeningAttemptErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    return {
      result: buildListeningAttemptResultDto(attempt, itemsWithKeys, attempt.answers),
      idempotentReplay: true,
    };
  }
}
