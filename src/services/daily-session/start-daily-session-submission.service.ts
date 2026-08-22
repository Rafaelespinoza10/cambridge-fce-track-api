import type { DataSource, EntityManager } from 'typeorm';
import { DailySessionsRepository } from '@repositories/daily-session/daily-sessions.repository';
import { DailySessionSubmissionsRepository } from '@repositories/daily-session/daily-session-submissions.repository';
import type { CreateSubmissionData } from '@repositories/daily-session/daily-session-submissions.repository';
import { toDailySessionSubmissionSafeDto } from '@lib/daily-session/daily-session-submission-dto';
import type { DailySession } from '../../models/DailySession';
import type { DailySessionSubmission } from '../../models/DailySessionSubmission';
import type { DailySessionSubmissionStartResultDto } from '../../interfaces/daily-session/daily-session.interface';

export enum StartDailySessionSubmissionErrorCode {
  INVALID_INPUT = 'invalid_input',
  SESSION_NOT_FOUND = 'session_not_found',
}

export class StartDailySessionSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: StartDailySessionSubmissionErrorCode,
  ) {
    super(message);
    this.name = 'StartDailySessionSubmissionError';
  }
}

type RepositorySource = DataSource | EntityManager;

export interface DailySessionsRepositoryPort {
  findByIdForUser(sessionId: string, userId: string): Promise<DailySession | null>;
}

export interface DailySessionSubmissionsRepositoryPort {
  findByDailySessionIdForUser(
    dailySessionId: string,
    userId: string,
  ): Promise<DailySessionSubmission | null>;
  createSubmission(data: CreateSubmissionData): Promise<DailySessionSubmission>;
}

export interface StartDailySessionSubmissionServiceDeps {
  dailySessions?: (source: RepositorySource) => DailySessionsRepositoryPort;
  dailySessionSubmissions?: (source: RepositorySource) => DailySessionSubmissionsRepositoryPort;
}

const DEFAULT_DAILY_SESSIONS_FACTORY = (source: RepositorySource): DailySessionsRepositoryPort =>
  new DailySessionsRepository(source);
const DEFAULT_DAILY_SESSION_SUBMISSIONS_FACTORY = (
  source: RepositorySource,
): DailySessionSubmissionsRepositoryPort => new DailySessionSubmissionsRepository(source);

function invalidInput(message: string): never {
  throw new StartDailySessionSubmissionError(
    message,
    StartDailySessionSubmissionErrorCode.INVALID_INPUT,
  );
}

/**
 * Gets or creates the (at most one, ever — see uq_daily_session_submissions_session)
 * submission for a Daily Session. Unlike Practice/Writing there is no
 * "one active submission per user across ANY session" constraint to race
 * against — a user only ever has one Daily Session per calendar day (see
 * GenerateDailySessionService), so there is naturally never more than one
 * in-progress submission at a time. Resume semantics: if a submission
 * already exists (in_progress, graded, or abandoned), return it as-is
 * (resumed: true) rather than erroring — the caller/controller decides how
 * to react to a non-in_progress status.
 */
export class StartDailySessionSubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: StartDailySessionSubmissionServiceDeps = {},
  ) {}

  async execute(
    userId: string,
    dailySessionId: string,
    startedAt: Date,
  ): Promise<DailySessionSubmissionStartResultDto> {
    if (typeof userId !== 'string' || userId.trim() === '') invalidInput('userId is required');
    if (typeof dailySessionId !== 'string' || dailySessionId.trim() === '') {
      invalidInput('dailySessionId is required');
    }
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
      invalidInput('startedAt must be a valid Date');
    }

    const sessionsFactory = this.deps.dailySessions ?? DEFAULT_DAILY_SESSIONS_FACTORY;
    const session = await sessionsFactory(this.dataSource).findByIdForUser(dailySessionId, userId);
    if (session === null) {
      throw new StartDailySessionSubmissionError(
        'Daily session not found',
        StartDailySessionSubmissionErrorCode.SESSION_NOT_FOUND,
      );
    }

    const submissionsFactory =
      this.deps.dailySessionSubmissions ?? DEFAULT_DAILY_SESSION_SUBMISSIONS_FACTORY;
    const submissionsRepo = submissionsFactory(this.dataSource);

    const existing = await submissionsRepo.findByDailySessionIdForUser(dailySessionId, userId);
    if (existing !== null) {
      return { submission: toDailySessionSubmissionSafeDto(existing), resumed: true };
    }

    const created = await submissionsRepo.createSubmission({
      userId,
      dailySessionId,
      startedAt,
    });
    return { submission: toDailySessionSubmissionSafeDto(created), resumed: false };
  }
}
