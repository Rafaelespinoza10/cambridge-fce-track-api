import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapFlashcardError } from '@lib/flashcard-error-mapper';
import { buildFlashcardsServices } from '../services/flashcards/flashcards-composition';
import { FlashcardType } from '../models/enums';
import type {
  CreateFlashcardRequestBody,
  UpdateFlashcardRequestBody,
  CreateWordFamilyRequestBody,
  FlashcardListStatus,
  FlashcardDto,
  WordFamilyDto,
} from '../interfaces/flashcards/flashcards.interface';

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
  createWordFamily(
    userId: string,
    deckId: string,
    now: Date,
    input: CreateWordFamilyRequestBody,
  ): Promise<WordFamilyDto>;
  listWordFamilies(userId: string, deckId: string): Promise<WordFamilyDto[]>;
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

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

async function createFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function createFlashcard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return createFlashcardHandler(event, DEFAULT_DEPS);
}

async function listFlashcardsHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function listFlashcards(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listFlashcardsHandler(event, DEFAULT_DEPS);
}

async function createWordFamilyHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  let body: CreateWordFamilyRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateWordFamilyRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { flashcards } = await deps.services();
    const family = await flashcards.createWordFamily(payload.sub, deckId, deps.now(), body);
    return successResponse({ success: true, data: family }, 201);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function createWordFamily(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return createWordFamilyHandler(event, DEFAULT_DEPS);
}

async function listWordFamiliesHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  try {
    const { flashcards } = await deps.services();
    const families = await flashcards.listWordFamilies(payload.sub, deckId);
    return successResponse({ success: true, data: families }, 200);
  } catch (err: unknown) {
    return handleError(mapFlashcardError(err));
  }
}

export async function listWordFamilies(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return listWordFamiliesHandler(event, DEFAULT_DEPS);
}

async function getFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function getFlashcard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return getFlashcardHandler(event, DEFAULT_DEPS);
}

async function updateFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function updateFlashcard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return updateFlashcardHandler(event, DEFAULT_DEPS);
}

async function suspendFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function suspendFlashcard(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return suspendFlashcardHandler(event, DEFAULT_DEPS);
}

async function reactivateFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function reactivateFlashcard(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return reactivateFlashcardHandler(event, DEFAULT_DEPS);
}

async function deleteFlashcardHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardControllerDeps,
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

export async function deleteFlashcard(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return deleteFlashcardHandler(event, DEFAULT_DEPS);
}

export {
  createFlashcardHandler,
  listFlashcardsHandler,
  createWordFamilyHandler,
  listWordFamiliesHandler,
  getFlashcardHandler,
  updateFlashcardHandler,
  suspendFlashcardHandler,
  reactivateFlashcardHandler,
  deleteFlashcardHandler,
};
export type { FlashcardControllerDeps, FlashcardsServicePort };
