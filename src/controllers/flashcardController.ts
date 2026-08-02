import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapFlashcardError } from '@lib/flashcard-error-mapper';
import { buildFlashcardsServices } from '../services/flashcards-composition';
import { FlashcardType } from '../models/enums';
import type {
  CreateFlashcardRequestBody,
  UpdateFlashcardRequestBody,
  FlashcardListStatus,
  FlashcardDto,
} from '../interfaces/flashcards.interface';

type NowProvider = () => Date;

interface FlashcardsServicePort {
  createFlashcard(
    userId: string,
    deckId: string,
    now: Date,
    input: CreateFlashcardRequestBody,
  ): Promise<FlashcardDto>;
  listFlashcards(
    userId: string,
    deckId: string,
    status: FlashcardListStatus,
    type?: FlashcardType,
  ): Promise<FlashcardDto[]>;
  getFlashcard(userId: string, flashcardId: string): Promise<FlashcardDto>;
  updateFlashcard(
    userId: string,
    flashcardId: string,
    input: UpdateFlashcardRequestBody,
  ): Promise<FlashcardDto>;
  suspendFlashcard(userId: string, flashcardId: string): Promise<FlashcardDto>;
  reactivateFlashcard(userId: string, flashcardId: string): Promise<FlashcardDto>;
  deleteFlashcard(userId: string, flashcardId: string): Promise<void>;
}

interface FlashcardControllerDeps {
  now: NowProvider;
  services: () => Promise<{ flashcards: FlashcardsServicePort }>;
}

const DEFAULT_DEPS: FlashcardControllerDeps = {
  now: () => new Date(),
  services: buildFlashcardsServices,
};

const VALID_LIST_STATUSES = new Set<string>(['active', 'suspended', 'all']);
const VALID_FLASHCARD_TYPES = new Set<string>(Object.values(FlashcardType));

function getDeckIdParam(event: APIGatewayProxyEvent): string | null {
  const deckId = event.pathParameters?.deckId ?? '';
  return deckId && isValidUuid(deckId) ? deckId : null;
}

function getFlashcardIdParam(event: APIGatewayProxyEvent): string | null {
  const flashcardId = event.pathParameters?.flashcardId ?? '';
  return flashcardId && isValidUuid(flashcardId) ? flashcardId : null;
}

export async function createFlashcard(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  let body: CreateFlashcardRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateFlashcardRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { flashcards } = await deps.services();
    const flashcard = await flashcards.createFlashcard(payload.sub, deckId, deps.now(), body);
    return successResponse({ success: true, data: flashcard }, 201);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function listFlashcards(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  const statusParam = event.queryStringParameters?.status ?? 'active';
  if (!VALID_LIST_STATUSES.has(statusParam)) {
    return errorResponse('status must be one of: active, suspended, all', 400);
  }

  const typeParam = event.queryStringParameters?.type;
  if (typeParam !== undefined && !VALID_FLASHCARD_TYPES.has(typeParam)) {
    return errorResponse('type must be a valid flashcard type', 400);
  }

  try {
    const { flashcards } = await deps.services();
    const result = await flashcards.listFlashcards(
      payload.sub,
      deckId,
      statusParam as FlashcardListStatus,
      typeParam as FlashcardType | undefined,
    );
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function getFlashcard(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const flashcardId = getFlashcardIdParam(event);
  if (flashcardId === null) return errorResponse('Invalid or missing flashcardId', 400);

  try {
    const { flashcards } = await deps.services();
    const flashcard = await flashcards.getFlashcard(payload.sub, flashcardId);
    return successResponse({ success: true, data: flashcard }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function updateFlashcard(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const flashcardId = getFlashcardIdParam(event);
  if (flashcardId === null) return errorResponse('Invalid or missing flashcardId', 400);

  let body: UpdateFlashcardRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateFlashcardRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { flashcards } = await deps.services();
    const flashcard = await flashcards.updateFlashcard(payload.sub, flashcardId, body);
    return successResponse({ success: true, data: flashcard }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function suspendFlashcard(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const flashcardId = getFlashcardIdParam(event);
  if (flashcardId === null) return errorResponse('Invalid or missing flashcardId', 400);

  try {
    const { flashcards } = await deps.services();
    const flashcard = await flashcards.suspendFlashcard(payload.sub, flashcardId);
    return successResponse({ success: true, data: flashcard }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function reactivateFlashcard(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const flashcardId = getFlashcardIdParam(event);
  if (flashcardId === null) return errorResponse('Invalid or missing flashcardId', 400);

  try {
    const { flashcards } = await deps.services();
    const flashcard = await flashcards.reactivateFlashcard(payload.sub, flashcardId);
    return successResponse({ success: true, data: flashcard }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function deleteFlashcard(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const flashcardId = getFlashcardIdParam(event);
  if (flashcardId === null) return errorResponse('Invalid or missing flashcardId', 400);

  try {
    const { flashcards } = await deps.services();
    await flashcards.deleteFlashcard(payload.sub, flashcardId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export type { FlashcardControllerDeps, FlashcardsServicePort };
