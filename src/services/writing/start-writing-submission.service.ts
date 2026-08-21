import type { DataSource, EntityManager } from 'typeorm';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';
import { WritingSubmissionsRepository } from '@repositories/writing/writing-submissions.repository';
import type { CreateSubmissionData } from '@repositories/writing/writing-submissions.repository';
import { PlanningRepository } from '@repositories/planning/planning.repository';
import type { WritingTask } from '../../models/WritingTask';
import type { WritingSubmission } from '../../models/WritingSubmission';
import type { WritingTaskSafeDto } from '../../interfaces/writing/writing-task.interface';
import type { WritingSubmissionStartResultDto } from '../../interfaces/writing/writing-submission.interface';
import { toWritingSubmissionSafeDto } from '@lib/writing/writing-submission-dto';

export enum StartWritingSubmissionErrorCode {
  INVALID_INPUT = 'invalid_input',
  TASK_NOT_FOUND = 'task_not_found',
  PLAN_DAY_NOT_FOUND = 'plan_day_not_found',
  ACTIVE_SUBMISSION_ON_ANOTHER_TASK = 'active_submission_on_another_task',
  RACE_UNRESOLVED = 'race_unresolved',
}

export class StartWritingSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: StartWritingSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'StartWritingSubmissionError';
  }
}

type RepositorySource = DataSource | EntityManager;

export interface WritingTasksRepositoryPort {
  findByIdForUser(taskId: string, userId: string): Promise<WritingTask | null>;
  findSafeTaskForUser(taskId: string, userId: string): Promise<WritingTaskSafeDto | null>;
}

export interface WritingSubmissionsRepositoryPort {
  findActiveByUser(userId: string): Promise<WritingSubmission | null>;
  createSubmission(data: CreateSubmissionData): Promise<WritingSubmission>;
}

export interface PlanDayLookupPort {
  findPlanDayByIdAndUser(planDayId: string, userId: string): Promise<{ id: string } | null>;
}

export interface StartWritingSubmissionServiceDeps {
  writingTasks?: (source: RepositorySource) => WritingTasksRepositoryPort;
  writingSubmissions?: (source: RepositorySource) => WritingSubmissionsRepositoryPort;
  planDays?: (dataSource: DataSource) => PlanDayLookupPort;
}

const DEFAULT_WRITING_TASKS_FACTORY = (source: RepositorySource): WritingTasksRepositoryPort =>
  new WritingTasksRepository(source);
const DEFAULT_WRITING_SUBMISSIONS_FACTORY = (
  source: RepositorySource,
): WritingSubmissionsRepositoryPort => new WritingSubmissionsRepository(source);
const DEFAULT_PLAN_DAYS_FACTORY = (dataSource: DataSource): PlanDayLookupPort =>
  new PlanningRepository(dataSource);

const MAX_RACE_RETRIES = 1;
const ACTIVE_SUBMISSION_CONSTRAINT_NAME = 'uq_writing_submissions_one_active_per_user';
const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';

// Same detection pattern as StartPracticeAttemptService.
function isActiveSubmissionConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const driverError = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const code = driverError.code ?? driverError.driverError?.code;
  const constraint = driverError.constraint ?? driverError.driverError?.constraint;
  return (
    code === POSTGRES_UNIQUE_VIOLATION_CODE && constraint === ACTIVE_SUBMISSION_CONSTRAINT_NAME
  );
}

function invalidInput(message: string): never {
  throw new StartWritingSubmissionError(message, StartWritingSubmissionErrorCode.INVALID_INPUT);
}

/**
 * Starts a new submission or resumes the existing one, per the
 * one-active-submission-per-user constraint (see AddWritingDomain migration):
 *   - active submission on the SAME task -> resume it (resumed: true)
 *   - active submission on a DIFFERENT task -> reject (409)
 *   - no active submission -> create one
 * Mirrors StartPracticeAttemptService exactly.
 */
export class StartWritingSubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: StartWritingSubmissionServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    taskId: string,
    startedAt: Date,
    planDayId: string | null = null,
  ): Promise<WritingSubmissionStartResultDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (typeof taskId !== 'string' || taskId.trim() === '') invalidInput('taskId is required');
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
      invalidInput('startedAt must be a valid Date');
    }
    if (planDayId !== null && (typeof planDayId !== 'string' || planDayId.trim() === '')) {
      invalidInput('planDayId must be a non-empty string when provided');
    }

    const tasksFactory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
    const task = await tasksFactory(this.dataSource).findByIdForUser(taskId, userId);
    if (task === null) {
      throw new StartWritingSubmissionError(
        'Writing task not found',
        StartWritingSubmissionErrorCode.TASK_NOT_FOUND,
      );
    }

    if (planDayId !== null) {
      const planDaysFactory = this.deps.planDays ?? DEFAULT_PLAN_DAYS_FACTORY;
      const planDay = await planDaysFactory(this.dataSource).findPlanDayByIdAndUser(
        planDayId,
        userId,
      );
      if (planDay === null) {
        throw new StartWritingSubmissionError(
          'Plan day not found',
          StartWritingSubmissionErrorCode.PLAN_DAY_NOT_FOUND,
        );
      }
    }

    return this.executeWithRetry(userId, task, startedAt, planDayId, 0);
  }

  private async executeWithRetry(
    userId: string,
    task: WritingTask,
    startedAt: Date,
    planDayId: string | null,
    attempt: number,
  ): Promise<WritingSubmissionStartResultDto> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.runInTransaction(manager, userId, task, startedAt, planDayId),
      );
    } catch (error) {
      if (isActiveSubmissionConstraintViolation(error)) {
        if (attempt < MAX_RACE_RETRIES) {
          return this.executeWithRetry(userId, task, startedAt, planDayId, attempt + 1);
        }
        throw new StartWritingSubmissionError(
          'Could not resolve the active writing submission after a race retry',
          StartWritingSubmissionErrorCode.RACE_UNRESOLVED,
        );
      }
      throw error;
    }
  }

  private async runInTransaction(
    manager: EntityManager,
    userId: string,
    task: WritingTask,
    startedAt: Date,
    planDayId: string | null,
  ): Promise<WritingSubmissionStartResultDto> {
    const submissionsFactory = this.deps.writingSubmissions ?? DEFAULT_WRITING_SUBMISSIONS_FACTORY;
    const submissionsRepo = submissionsFactory(manager);

    const active = await submissionsRepo.findActiveByUser(userId);
    if (active !== null) {
      if (active.task_id === task.id) {
        return this.buildResult(manager, active, true);
      }
      throw new StartWritingSubmissionError(
        'You already have an active writing submission on a different task',
        StartWritingSubmissionErrorCode.ACTIVE_SUBMISSION_ON_ANOTHER_TASK,
      );
    }

    const created = await submissionsRepo.createSubmission({
      userId,
      taskId: task.id,
      startedAt,
      planDayId,
    });
    return this.buildResult(manager, created, false);
  }

  private async buildResult(
    source: RepositorySource,
    submission: WritingSubmission,
    resumed: boolean,
  ): Promise<WritingSubmissionStartResultDto> {
    const tasksFactory = this.deps.writingTasks ?? DEFAULT_WRITING_TASKS_FACTORY;
    const task = await tasksFactory(source).findSafeTaskForUser(
      submission.task_id,
      submission.user_id,
    );
    if (task === null) {
      // Unreachable given the composite FK (submission.task_id, user_id) ->
      // writing_tasks(id, user_id), but fail loudly instead of returning a
      // result with no task.
      throw new Error('Failed to re-read the task for a writing submission that references it');
    }
    return {
      view: { submission: toWritingSubmissionSafeDto(submission), task, result: null },
      resumed,
    };
  }
}
