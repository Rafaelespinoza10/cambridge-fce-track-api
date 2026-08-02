import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapFlashcardProgressError } from '@lib/flashcard-progress-error-mapper';
import { buildFlashcardProgressServices } from '../services/flashcard-progress-composition';
import type {
  FlashcardPreferencesDto,
  UpdateFlashcardPreferencesRequest,
  FlashcardReviewSummaryDto,
} from '../interfaces/flashcard-progress.interface';

type NowProvider = () => Date;

interface FlashcardProgressServicePort {
  getPreferences(userId: string): Promise<FlashcardPreferencesDto>;
  updatePreferences(
    userId: string,
    input: UpdateFlashcardPreferencesRequest,
  ): Promise<FlashcardPreferencesDto>;
  getReviewSummary(userId: string, now: Date): Promise<FlashcardReviewSummaryDto>;
}

interface FlashcardProgressControllerDeps {
  now: NowProvider;
  services: () => Promise<{ progress: FlashcardProgressServicePort }>;
}

const DEFAULT_DEPS: FlashcardProgressControllerDeps = {
  now: () => new Date(),
  services: buildFlashcardProgressServices,
};

export async function getFlashcardPreferences(
  event: APIGatewayProxyEvent,
  deps: FlashcardProgressControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { progress } = await deps.services();
    const preferences = await progress.getPreferences(payload.sub);
    return successResponse({ success: true, data: preferences }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardProgressError(err));
  }
}

export async function updateFlashcardPreferences(
  event: APIGatewayProxyEvent,
  deps: FlashcardProgressControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: UpdateFlashcardPreferencesRequest;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateFlashcardPreferencesRequest;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { progress } = await deps.services();
    const preferences = await progress.updatePreferences(payload.sub, body);
    return successResponse({ success: true, data: preferences }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardProgressError(err));
  }
}

export async function getFlashcardReviewSummary(
  event: APIGatewayProxyEvent,
  deps: FlashcardProgressControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { progress } = await deps.services();
    const summary = await progress.getReviewSummary(payload.sub, deps.now());
    return successResponse({ success: true, data: summary }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardProgressError(err));
  }
}

export type { FlashcardProgressControllerDeps, FlashcardProgressServicePort };
