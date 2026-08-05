import type { StudySessionStatus } from '../../models/enums';

export interface CompleteFlashcardReviewSessionInput {
  userId: string;
  studySessionId: string;
  /** Instante explícito del cierre — el servicio nunca llama a new Date(). */
  completedAt: Date;
}

export interface CompleteFlashcardReviewSessionSessionResult {
  id: string;
  status: StudySessionStatus;
  startedAt: Date;
  endedAt: Date;
  durationMinutes: number;
}

export interface CompleteFlashcardReviewSessionSummary {
  reviewsCount: number;
}

export interface CompleteFlashcardReviewSessionResult {
  session: CompleteFlashcardReviewSessionSessionResult;
  summary: CompleteFlashcardReviewSessionSummary;
  /**
   * false: esta ejecución transicionó la sesión de active a completed.
   * true: la sesión ya estaba completada; se devolvió su estado persistido
   * sin volver a modificarla.
   */
  idempotentReplay: boolean;
}
