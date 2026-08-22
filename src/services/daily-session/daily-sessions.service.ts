import type { DailySessionSafeWithItems } from '../../interfaces/daily-session/daily-session.interface';

export enum DailySessionErrorCode {
  SESSION_NOT_FOUND = 'session_not_found',
}

export class DailySessionError extends Error {
  constructor(
    message: string,
    readonly code: DailySessionErrorCode,
  ) {
    super(message);
    this.name = 'DailySessionError';
  }
}

interface DailySessionsRepositoryPort {
  findSafeSessionForUser(sessionId: string, userId: string): Promise<DailySessionSafeWithItems | null>;
}

export interface DailySessionsServiceDeps {
  repository: DailySessionsRepositoryPort;
}

/** Thin read wrapper: never selects/exposes answerKey or explanation (see the repository method it calls). */
export class DailySessionsService {
  constructor(private readonly deps: DailySessionsServiceDeps) {}

  async getSession(userId: string, sessionId: string): Promise<DailySessionSafeWithItems> {
    const result = await this.deps.repository.findSafeSessionForUser(sessionId, userId);
    if (result === null) {
      throw new DailySessionError('Daily session not found', DailySessionErrorCode.SESSION_NOT_FOUND);
    }
    return result;
  }
}
