import type { DataSource, EntityManager } from 'typeorm';
import { PracticeAttemptsRepository } from '../../repositories/practice-attempts.repository';
import type { CompleteAttemptData } from '../../repositories/practice-attempts.repository';
import { PracticeExercisesRepository } from '../../repositories/practice-exercises.repository';
import { PracticeAnswersRepository } from '../../repositories/practice-answers.repository';
import type { CreateAnswerData } from '../../repositories/practice-answers.repository';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import { PracticeAttemptStatus } from '../../models/enums';
import { createAiLinkedPlannedActivity } from '../planning/create-ai-linked-activity';
import type { CreateAiLinkedPlannedActivityInput } from '../planning/create-ai-linked-activity';
import { resolvePlanDayIdForDate } from '../planning/resolve-plan-day-for-date';
import type { PracticeAnswerPayload } from '../../models/practice-json-types';
import { isPracticeAnswerPayload } from '../../lib/practice-jsonb-validators';
import {
  gradeItem,
  roundToTwoDecimals,
  computeFeedbackSummary,
  buildPracticeAttemptResultDto,
} from '../../lib/practice-attempt-grading';
import type {
  SubmitPracticeAttemptAnswerInput,
  PracticeAttemptSubmitResultDto,
} from '../../interfaces/practice/practice-attempt.interface';

export enum SubmitPracticeAttemptErrorCode {
  INVALID_INPUT = 'invalid_input',
  ATTEMPT_NOT_FOUND = 'attempt_not_found',
  ATTEMPT_ABANDONED = 'attempt_abandoned',
  PERSISTENCE_INCONSISTENCY = 'persistence_inconsistency',
}

export class SubmitPracticeAttemptError extends Error {
  constructor(
    message: string,
    readonly code: SubmitPracticeAttemptErrorCode,
  ) {
    super(message);
    this.name = 'SubmitPracticeAttemptError';
  }
}

type RepositorySource = DataSource | EntityManager;

export interface PracticeAttemptsRepositoryPort {
  findByIdForUpdate(
    attemptId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<PracticeAttempt | null>;
  completeAttempt(
    attemptId: string,
    userId: string,
    data: CompleteAttemptData,
  ): Promise<{ affected?: number | null }>;
}

export interface PracticeExercisesRepositoryPort {
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ items: PracticeItem[]; exercise: { title: string; part_code: string } } | null>;
}

export interface PracticeAnswersRepositoryPort {
  createAnswers(answers: CreateAnswerData[]): Promise<PracticeAnswer[]>;
  findByAttemptForUser(attemptId: string, userId: string): Promise<PracticeAnswer[]>;
}

export interface SubmitPracticeAttemptServiceDeps {
  practiceAttempts?: (source: RepositorySource) => PracticeAttemptsRepositoryPort;
  practiceExercises?: (source: RepositorySource) => PracticeExercisesRepositoryPort;
  practiceAnswers?: (source: RepositorySource) => PracticeAnswersRepositoryPort;
  // Injectable seam for tests — the default is the real, transaction-scoped
  // helper (see create-ai-linked-activity.ts), which unit tests replace with
  // a spy instead of exercising a real EntityManager.
  createAiLinkedActivity?: (
    manager: EntityManager,
    input: CreateAiLinkedPlannedActivityInput,
  ) => Promise<unknown>;
  // Injectable seam for tests — the default is the real, transaction-scoped
  // helper (see resolve-plan-day-for-date.ts).
  resolvePlanDayId?: (manager: EntityManager, userId: string, dateKey: string) => Promise<string>;
}

const DEFAULT_PRACTICE_ATTEMPTS_FACTORY = (
  source: RepositorySource,
): PracticeAttemptsRepositoryPort => new PracticeAttemptsRepository(source);
const DEFAULT_PRACTICE_EXERCISES_FACTORY = (
  source: RepositorySource,
): PracticeExercisesRepositoryPort => new PracticeExercisesRepository(source);
const DEFAULT_PRACTICE_ANSWERS_FACTORY = (
  source: RepositorySource,
): PracticeAnswersRepositoryPort => new PracticeAnswersRepository(source);

function invalidInput(message: string): never {
  throw new SubmitPracticeAttemptError(message, SubmitPracticeAttemptErrorCode.INVALID_INPUT);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Shape-only validation — cross-referencing against the real item set happens once the exercise is fetched. */
function validateAnswersShape(answers: unknown): SubmitPracticeAttemptAnswerInput[] {
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
      // reach answer_payload.
      answer: toCleanPayload(entry.answer),
      responseTimeMs: (entry.responseTimeMs as number | null | undefined) ?? null,
    };
  });
}

/** Strips any extra client-supplied properties (e.g. a spoofed `isCorrect`) — only the fields the kind actually needs survive. */
function toCleanPayload(payload: PracticeAnswerPayload): PracticeAnswerPayload {
  if (payload.kind === 'single_choice')
    return { kind: 'single_choice', optionId: payload.optionId };
  if (payload.kind === 'text') return { kind: 'text', value: payload.value };
  return { kind: 'unanswered' };
}

interface GradedItem {
  item: PracticeItem;
  payload: PracticeAnswerPayload;
  responseTimeMs: number | null;
  isCorrect: boolean;
  normalizedAnswer: string | null;
}

/**
 * Grades and persists a full attempt submission in a single transaction:
 * pessimistic lock -> validate ownership/status -> fetch the real answer
 * keys -> grade every item deterministically -> create all answers ->
 * complete the attempt. Any failure rolls back everything — never a partial
 * write. Client-sent score/timestamps/isCorrect are never read; only
 * itemId/answer/responseTimeMs are.
 */
export class SubmitPracticeAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: SubmitPracticeAttemptServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    attemptId: string,
    rawAnswers: unknown,
    submittedAt: Date,
  ): Promise<PracticeAttemptSubmitResultDto> {
    if (!isNonEmptyString(userId)) invalidInput('userId is required');
    if (!isNonEmptyString(attemptId)) invalidInput('attemptId is required');
    if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) {
      invalidInput('submittedAt must be a valid Date');
    }
    const answers = validateAnswersShape(rawAnswers);

    return this.dataSource.transaction((manager) =>
      this.runInTransaction(manager, userId, attemptId, answers, submittedAt),
    );
  }

  private async runInTransaction(
    manager: EntityManager,
    userId: string,
    attemptId: string,
    answers: SubmitPracticeAttemptAnswerInput[],
    submittedAt: Date,
  ): Promise<PracticeAttemptSubmitResultDto> {
    const attemptsFactory = this.deps.practiceAttempts ?? DEFAULT_PRACTICE_ATTEMPTS_FACTORY;
    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const answersFactory = this.deps.practiceAnswers ?? DEFAULT_PRACTICE_ANSWERS_FACTORY;

    const attemptsRepo = attemptsFactory(manager);
    const attempt = await attemptsRepo.findByIdForUpdate(attemptId, userId, manager);
    if (attempt === null) {
      throw new SubmitPracticeAttemptError(
        'Practice attempt not found',
        SubmitPracticeAttemptErrorCode.ATTEMPT_NOT_FOUND,
      );
    }

    if (attempt.status === PracticeAttemptStatus.COMPLETED) {
      // Idempotent replay: nothing is recomputed or re-inserted.
      return this.buildReplayResult(manager, attempt);
    }
    if (attempt.status === PracticeAttemptStatus.ABANDONED) {
      throw new SubmitPracticeAttemptError(
        'This practice attempt was abandoned and cannot be submitted',
        SubmitPracticeAttemptErrorCode.ATTEMPT_ABANDONED,
      );
    }

    const withKeys = await exercisesFactory(manager).findExerciseWithAnswerKeysForEvaluation(
      attempt.exercise_id,
      userId,
    );
    if (withKeys === null) {
      throw new SubmitPracticeAttemptError(
        'Failed to load the exercise answer keys for grading',
        SubmitPracticeAttemptErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }

    const itemsById = new Map(withKeys.items.map((item) => [item.id, item]));
    const submittedByItemId = new Map<string, SubmitPracticeAttemptAnswerInput>();
    for (const answer of answers) {
      if (submittedByItemId.has(answer.itemId)) {
        invalidInput(`duplicate answer submitted for item ${answer.itemId}`);
      }
      if (!itemsById.has(answer.itemId)) {
        invalidInput(`item ${answer.itemId} does not belong to this exercise`);
      }
      submittedByItemId.set(answer.itemId, answer);
    }

    // Exactly one answer per item — any item omitted from the request becomes 'unanswered'.
    const gradedItems: GradedItem[] = withKeys.items.map((item) => {
      const submitted = submittedByItemId.get(item.id);
      const payload: PracticeAnswerPayload = submitted?.answer ?? { kind: 'unanswered' };
      const responseTimeMs = submitted?.responseTimeMs ?? null;
      const graded = gradeItem(item.answer_key, payload);
      return { item, payload, responseTimeMs, ...graded };
    });

    const totalCount = withKeys.items.length;
    const correctCount = gradedItems.filter((g) => g.isCorrect).length;
    const percentage = roundToTwoDecimals((correctCount / totalCount) * 100);
    const durationSeconds = Math.max(
      0,
      Math.floor((submittedAt.getTime() - attempt.started_at.getTime()) / 1000),
    );
    const feedbackSummary = computeFeedbackSummary(
      gradedItems.map((g) => ({
        skillTags: g.item.skill_tags,
        isCorrect: g.isCorrect,
        isUnanswered: g.payload.kind === 'unanswered',
      })),
    );

    const answersToCreate: CreateAnswerData[] = gradedItems.map((g) => ({
      userId,
      exerciseId: attempt.exercise_id,
      attemptId: attempt.id,
      itemId: g.item.id,
      answerPayload: g.payload,
      normalizedAnswer: g.normalizedAnswer,
      isCorrect: g.isCorrect,
      responseTimeMs: g.responseTimeMs,
      feedback: null,
    }));
    await answersFactory(manager).createAnswers(answersToCreate);

    await attemptsRepo.completeAttempt(attempt.id, userId, {
      submittedAt,
      durationSeconds,
      correctCount,
      percentage,
      feedbackSummary,
    });

    // Register on the Plan/Home only once the attempt is really finished —
    // never at start time. Every completed attempt registers: the day
    // picked at start time (StartPracticeAttemptService) if there was one,
    // otherwise the attempt defaults to the day it was actually completed.
    {
      const linker = this.deps.createAiLinkedActivity ?? createAiLinkedPlannedActivity;
      const resolveDay = this.deps.resolvePlanDayId ?? resolvePlanDayIdForDate;
      const planDayId =
        attempt.plan_day_id ??
        (await resolveDay(manager, userId, submittedAt.toISOString().slice(0, 10)));
      const examSectionSlug = withKeys.exercise.part_code.toLowerCase().replace(/_/g, '-');
      await linker(manager, {
        planDayId,
        title: `Use of English — ${withKeys.exercise.title}`,
        skillSlug: 'use-of-english',
        examSectionSlug,
        estimatedDurationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
        completedAt: submittedAt,
        practiceAttemptId: attempt.id,
      });
    }

    const completedAttempt = {
      ...attempt,
      status: PracticeAttemptStatus.COMPLETED,
      submitted_at: submittedAt,
      duration_seconds: durationSeconds,
      correct_count: correctCount,
      total_count: totalCount,
      percentage: String(percentage),
      feedback_summary: feedbackSummary,
    } as PracticeAttempt;

    const persistedAnswers = gradedItems.map(
      (g) =>
        ({
          item_id: g.item.id,
          answer_payload: g.payload,
          normalized_answer: g.normalizedAnswer,
          is_correct: g.isCorrect,
          response_time_ms: g.responseTimeMs,
        }) as PracticeAnswer,
    );

    return {
      result: buildPracticeAttemptResultDto(completedAttempt, withKeys.items, persistedAnswers),
      idempotentReplay: false,
    };
  }

  private async buildReplayResult(
    source: RepositorySource,
    attempt: PracticeAttempt,
  ): Promise<PracticeAttemptSubmitResultDto> {
    const exercisesFactory = this.deps.practiceExercises ?? DEFAULT_PRACTICE_EXERCISES_FACTORY;
    const answersFactory = this.deps.practiceAnswers ?? DEFAULT_PRACTICE_ANSWERS_FACTORY;

    const withKeys = await exercisesFactory(source).findExerciseWithAnswerKeysForEvaluation(
      attempt.exercise_id,
      attempt.user_id,
    );
    if (withKeys === null) {
      throw new SubmitPracticeAttemptError(
        'Failed to load the exercise answer keys while replaying a completed submission',
        SubmitPracticeAttemptErrorCode.PERSISTENCE_INCONSISTENCY,
      );
    }
    const answers = await answersFactory(source).findByAttemptForUser(attempt.id, attempt.user_id);

    return {
      result: buildPracticeAttemptResultDto(attempt, withKeys.items, answers),
      idempotentReplay: true,
    };
  }
}
