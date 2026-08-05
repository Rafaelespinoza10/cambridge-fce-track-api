import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapFlashcardReviewError } from '@lib/flashcard-review-error-mapper';
import { buildFlashcardReviewServices } from '../services/flashcards/flashcard-review-composition';
import { StudySessionStatus, ReviewRating } from '../models/enums';
import type {
  StartFlashcardReviewSessionResult,
  FlashcardQueueItem,
} from '../interfaces/flashcards/start-flashcard-review-session.interface';
import type { AnswerFlashcardResult } from '../interfaces/flashcards/flashcard-review.interface';
import type { CompleteFlashcardReviewSessionResult } from '../interfaces/flashcards/complete-flashcard-review-session.interface';
import type {
  StartReviewSessionRequestBody,
  AnswerFlashcardRequestBody,
  StartReviewSessionHttpResponse,
  AnswerFlashcardHttpResponse,
  CompleteReviewSessionHttpResponse,
  FlashcardQueueItemHttp,
} from '../interfaces/flashcards/flashcard-review-http.interface';

type NowProvider = () => Date;

interface StartSessionPort {
  execute(input: {
    userId: string;
    requestedAt: Date;
    deckId?: string;
  }): Promise<StartFlashcardReviewSessionResult>;
}

interface AnswerFlashcardPort {
  execute(input: {
    userId: string;
    studySessionId: string;
    flashcardId: string;
    rating: ReviewRating;
    idempotencyKey: string;
    reviewedAt: Date;
    responseTimeMs?: number;
  }): Promise<AnswerFlashcardResult>;
}

interface CompleteSessionPort {
  execute(input: {
    userId: string;
    studySessionId: string;
    completedAt: Date;
  }): Promise<CompleteFlashcardReviewSessionResult>;
}

interface FlashcardReviewControllerDeps {
  now: NowProvider;
  services: () => Promise<{
    startSession: StartSessionPort;
    answerFlashcard: AnswerFlashcardPort;
    completeSession: CompleteSessionPort;
  }>;
}

const DEFAULT_DEPS: FlashcardReviewControllerDeps = {
  now: () => new Date(),
  services: buildFlashcardReviewServices,
};

const VALID_RATINGS = new Set<string>(Object.values(ReviewRating));

function toQueueItemHttp(item: FlashcardQueueItem): FlashcardQueueItemHttp {
  return { ...item, nextReviewAt: item.nextReviewAt.toISOString() };
}

function toStartSessionHttpResponse(
  result: StartFlashcardReviewSessionResult,
): StartReviewSessionHttpResponse {
  return {
    session: {
      id: result.studySessionId,
      resumed: result.sessionResumed,
      startedAt: result.sessionStartedAt.toISOString(),
      // El servicio solo devuelve una sesión que acaba de crear o que verificó
      // como activa — nunca alcanza este punto con otro estado.
      status: StudySessionStatus.ACTIVE,
    },
    day: {
      localDate: result.localDate,
      timezone: result.timezone,
      dailyGoal: result.dailyGoal,
      cardsDueAtFirstSession: result.dailyProgress.cardsDueAtFirstSession,
      requiredReviews: result.dailyProgress.requiredReviews,
      cardsReviewed: result.dailyProgress.cardsReviewed,
      uniqueCardsReviewed: result.dailyProgress.uniqueCardsReviewed,
      goalCompleted: result.dailyProgress.goalCompleted,
    },
    queue: {
      cardsDue: result.queue.cardsDue,
      cards: result.queue.cards.map(toQueueItemHttp),
    },
  };
}

function toAnswerFlashcardHttpResponse(result: AnswerFlashcardResult): AnswerFlashcardHttpResponse {
  return {
    reviewId: result.reviewId,
    idempotentReplay: result.idempotentReplay,
    scheduling: {
      ...result.scheduling,
      previousNextReviewAt: result.scheduling.previousNextReviewAt.toISOString(),
      newNextReviewAt: result.scheduling.newNextReviewAt.toISOString(),
    },
    dailyProgress: result.dailyProgress,
    sessionProgress: result.sessionProgress,
  };
}

function toCompleteSessionHttpResponse(
  result: CompleteFlashcardReviewSessionResult,
): CompleteReviewSessionHttpResponse {
  return {
    session: {
      id: result.session.id,
      status: result.session.status,
      startedAt: result.session.startedAt.toISOString(),
      endedAt: result.session.endedAt.toISOString(),
      durationMinutes: result.session.durationMinutes,
    },
    summary: result.summary,
    idempotentReplay: result.idempotentReplay,
  };
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

// ── POST /flashcards/review-sessions ──────────────────────────────────────────

async function startFlashcardReviewSessionHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardReviewControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: StartReviewSessionRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as StartReviewSessionRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (body.deckId !== undefined && (typeof body.deckId !== 'string' || !isValidUuid(body.deckId))) {
    return errorResponse('deckId must be a valid UUID', 400);
  }

  try {
    const { startSession } = await deps.services();
    const result = await startSession.execute({
      userId: payload.sub,
      requestedAt: deps.now(),
      deckId: body.deckId,
    });
    const status = result.sessionResumed ? 200 : 201;
    return successResponse({ success: true, data: toStartSessionHttpResponse(result) }, status);
  } catch (err: unknown) {
    return handleError(mapFlashcardReviewError(err));
  }
}

export async function startFlashcardReviewSession(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return startFlashcardReviewSessionHandler(event, DEFAULT_DEPS);
}

// ── POST /flashcards/review-sessions/{sessionId}/answers ─────────────────────

async function answerFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardReviewControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const sessionId = event.pathParameters?.sessionId ?? '';
  if (!sessionId || !isValidUuid(sessionId))
    return errorResponse('Invalid or missing sessionId', 400);

  let body: AnswerFlashcardRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as AnswerFlashcardRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  if (!body.flashcardId || !isValidUuid(body.flashcardId)) {
    return errorResponse('flashcardId must be a valid UUID', 400);
  }
  if (!body.idempotencyKey || !isValidUuid(body.idempotencyKey)) {
    return errorResponse('idempotencyKey must be a valid UUID', 400);
  }
  if (!body.rating || !VALID_RATINGS.has(body.rating)) {
    return errorResponse(`rating must be one of: ${Object.values(ReviewRating).join(', ')}`, 400);
  }
  if (
    body.responseTimeMs !== undefined &&
    (!Number.isInteger(body.responseTimeMs) || body.responseTimeMs < 0)
  ) {
    return errorResponse('responseTimeMs must be a non-negative integer', 400);
  }

  try {
    const { answerFlashcard: answerFlashcardUseCase } = await deps.services();
    const result = await answerFlashcardUseCase.execute({
      userId: payload.sub,
      studySessionId: sessionId,
      flashcardId: body.flashcardId,
      rating: body.rating as ReviewRating,
      idempotencyKey: body.idempotencyKey,
      reviewedAt: deps.now(),
      responseTimeMs: body.responseTimeMs,
    });
    return successResponse({ success: true, data: toAnswerFlashcardHttpResponse(result) }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardReviewError(err));
  }
}

export async function answerFlashcard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return answerFlashcardHandler(event, DEFAULT_DEPS);
}

// ── POST /flashcards/review-sessions/{sessionId}/complete ────────────────────

async function completeFlashcardReviewSessionHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardReviewControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const sessionId = event.pathParameters?.sessionId ?? '';
  if (!sessionId || !isValidUuid(sessionId))
    return errorResponse('Invalid or missing sessionId', 400);

  const rawBody = event.body ?? '';
  if (rawBody.trim() !== '') {
    try {
      JSON.parse(rawBody);
    } catch {
      return errorResponse('Invalid request body', 400);
    }
  }

  try {
    const { completeSession } = await deps.services();
    const result = await completeSession.execute({
      userId: payload.sub,
      studySessionId: sessionId,
      completedAt: deps.now(),
    });
    return successResponse({ success: true, data: toCompleteSessionHttpResponse(result) }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardReviewError(err));
  }
}

export async function completeFlashcardReviewSession(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return completeFlashcardReviewSessionHandler(event, DEFAULT_DEPS);
}

export {
  startFlashcardReviewSessionHandler,
  answerFlashcardHandler,
  completeFlashcardReviewSessionHandler,
};
export type {
  FlashcardReviewControllerDeps,
  NowProvider,
  StartSessionPort,
  AnswerFlashcardPort,
  CompleteSessionPort,
};
