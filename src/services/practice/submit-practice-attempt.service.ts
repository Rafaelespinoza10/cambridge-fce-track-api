import type { DataSource, EntityManager } from 'typeorm';
import { PracticeAttemptsRepository } from '@repositories/practice/practice-attempts.repository';
import type { CompleteAttemptData } from '@repositories/practice/practice-attempts.repository';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { PracticeAnswersRepository } from '@repositories/practice/practice-answers.repository';
import type { CreateAnswerData } from '@repositories/practice/practice-answers.repository';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import { PracticeAttemptStatus } from '../../models/enums';
import type { EnglishLevel } from '../../models/enums';
import { RecordPracticeMistakesService } from '../mistakes/record-practice-mistakes.service';
import { SyncWeaknessReviewsService } from '../mistakes/sync-weakness-reviews.service';
import type { SyncWeaknessReviewsInput } from '../mistakes/sync-weakness-reviews.service';
import type { ReviewOutcomeDto } from '../../interfaces/mistakes/reviews.interface';
import type { PracticeExerciseGenerationMetadata } from '../../models/practice-json-types';
import type { RecordPracticeMistakesInput } from '../mistakes/record-practice-mistakes.service';
import { createAiLinkedPlannedActivity } from '../planning/create-ai-linked-activity';
import type { CreateAiLinkedPlannedActivityInput } from '../planning/create-ai-linked-activity';
import { resolvePlanDayIdForDate } from '../planning/resolve-plan-day-for-date';
import { resolveUserLocalDayKey } from '../planning/resolve-user-local-day';
import type { PracticeAnswerPayload } from '../../models/practice-json-types';
import { isPracticeAnswerPayload } from '@lib/practice/practice-jsonb-validators';
import {
  gradeItem,
  roundToTwoDecimals,
  computeFeedbackSummary,
  buildPracticeAttemptResultDto,
} from '@lib/practice/practice-attempt-grading';
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

/**
 * The exercise fields this service reads — a structural subset of what
 * PracticeExercisesRepository really returns (the full PracticeExercise).
 * `id`/`exam_code`/`paper_code`/`target_level` are here for the Mistake Bank
 * (see RecordPracticeMistakesService), which files a mistake under the exam
 * coordinates of the exercise it came from.
 */
export interface SubmitPracticeAttemptExercise {
  id: string;
  title: string;
  instructions: string;
  stimulus: string | null;
  exam_code: string;
  paper_code: string;
  part_code: string;
  target_level: EnglishLevel | null;
  /**
   * How this exercise was built. Spaced retesting needs it to tell a plain
   * practice submission (which never touches a review) from a Mistake Bank
   * session, and a retest from ordinary remediation. The repository already
   * returns the full entity — this only widens the structural subset this
   * service declares.
   */
  generation_metadata: PracticeExerciseGenerationMetadata | null;
}

export interface PracticeExercisesRepositoryPort {
  findExerciseWithAnswerKeysForEvaluation(
    exerciseId: string,
    userId: string,
  ): Promise<{ items: PracticeItem[]; exercise: SubmitPracticeAttemptExercise } | null>;
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
  resolveUserLocalDayKey?: (
    manager: EntityManager,
    userId: string,
    instant: Date,
  ) => Promise<string>;
  // Injectable seam for tests — the default is the real Mistake Bank
  // recorder (see record-practice-mistakes.service.ts), which runs on this
  // submission's own EntityManager.
  recordMistakes?: (manager: EntityManager, input: RecordPracticeMistakesInput) => Promise<unknown>;
  // Injectable seam for tests — the default is the real spaced-retesting
  // scheduler (see sync-weakness-reviews.service.ts), which runs on this
  // submission's own EntityManager.
  syncWeaknessReviews?: (
    manager: EntityManager,
    input: SyncWeaknessReviewsInput,
  ) => Promise<ReviewOutcomeDto[]>;
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

const DEFAULT_RECORD_MISTAKES = (
  manager: EntityManager,
  input: RecordPracticeMistakesInput,
): Promise<unknown> => new RecordPracticeMistakesService().record(manager, input);

const DEFAULT_SYNC_WEAKNESS_REVIEWS = (
  manager: EntityManager,
  input: SyncWeaknessReviewsInput,
): Promise<ReviewOutcomeDto[]> => new SyncWeaknessReviewsService().sync(manager, input);

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
    const persistedAnswerRows = await answersFactory(manager).createAnswers(answersToCreate);
    const answerIdByItemId = new Map(
      persistedAnswerRows.map((answer) => [answer.item_id, answer.id]),
    );

    await attemptsRepo.completeAttempt(attempt.id, userId, {
      submittedAt,
      durationSeconds,
      correctCount,
      percentage,
      feedbackSummary,
    });

    // Mistake Bank: every wrong answer of this submission becomes (or
    // reinforces) a mistake concept, and every correct one can only mark a
    // previously failed concept as answered right again — a correct answer
    // never creates a mistake. Recorded inside this same transaction, like
    // the Plan/Home linking below, so a completed attempt and its mistakes
    // can never disagree. Nothing is re-graded here: it only reads the
    // isCorrect this service already computed.
    {
      const recordMistakes = this.deps.recordMistakes ?? DEFAULT_RECORD_MISTAKES;
      await recordMistakes(manager, {
        userId,
        attemptId: attempt.id,
        exercise: withKeys.exercise,
        occurredAt: submittedAt,
        items: gradedItems.map((graded) => ({
          item: graded.item,
          payload: graded.payload,
          normalizedAnswer: graded.normalizedAnswer,
          isCorrect: graded.isCorrect,
          answerId: answerIdByItemId.get(graded.item.id) ?? null,
        })),
      });
    }

    // Register on the Plan/Home only once the attempt is really finished —
    // never at start time. Every completed attempt registers: the day
    // picked at start time (StartPracticeAttemptService) if there was one,
    // otherwise the attempt defaults to the day it was actually completed.
    {
      const linker = this.deps.createAiLinkedActivity ?? createAiLinkedPlannedActivity;
      const resolveDay = this.deps.resolvePlanDayId ?? resolvePlanDayIdForDate;
      const resolveLocalDayKey = this.deps.resolveUserLocalDayKey ?? resolveUserLocalDayKey;
      // The user's OWN calendar day, not submittedAt's UTC day — see
      // resolve-user-local-day.ts. Only reached when start time didn't
      // already capture a plan day.
      const planDayId =
        attempt.plan_day_id ??
        (await resolveDay(manager, userId, await resolveLocalDayKey(manager, userId, submittedAt)));
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

    // Spaced retesting, last: it reads the mastery this submission just
    // produced, so it has to run after the Mistake Bank recorded the
    // answers. Closes any review this attempt was a retest for and keeps the
    // user's schedule in step; a plain practice submission is a no-op.
    const reviewOutcomes = await (this.deps.syncWeaknessReviews ?? DEFAULT_SYNC_WEAKNESS_REVIEWS)(
      manager,
      {
        userId,
        attemptId: attempt.id,
        exerciseId: attempt.exercise_id,
        partCode: withKeys.exercise.part_code,
        generationMetadata: withKeys.exercise.generation_metadata,
        submittedAt,
        items: gradedItems.map((graded) => ({
          metadata: graded.item.metadata,
          isCorrect: graded.isCorrect,
          normalizedAnswer: graded.normalizedAnswer,
        })),
      },
    );

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
      result: buildPracticeAttemptResultDto(
        completedAttempt,
        withKeys.exercise,
        withKeys.items,
        persistedAnswers,
      ),
      idempotentReplay: false,
      // Empty for everything except a spaced retest — one entry per review
      // this submission just closed.
      reviewOutcomes,
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
      result: buildPracticeAttemptResultDto(attempt, withKeys.exercise, withKeys.items, answers),
      idempotentReplay: true,
      // A replay re-grades nothing and re-schedules nothing, so it has no
      // review outcome to report either.
      reviewOutcomes: [],
    };
  }
}
