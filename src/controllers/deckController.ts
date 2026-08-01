import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapDeckError } from '@lib/deck-error-mapper';
import { buildDecksServices } from '../services/decks-composition';
import type {
  CreateDeckRequestBody,
  UpdateDeckRequestBody,
  DeckListStatus,
  DeckDto,
} from '../interfaces/decks.interface';

interface DecksServicePort {
  createDeck(userId: string, input: CreateDeckRequestBody): Promise<DeckDto>;
  listDecks(userId: string, status: DeckListStatus): Promise<DeckDto[]>;
  getDeck(userId: string, deckId: string): Promise<DeckDto>;
  updateDeck(userId: string, deckId: string, input: UpdateDeckRequestBody): Promise<DeckDto>;
  archiveDeck(userId: string, deckId: string): Promise<DeckDto>;
  unarchiveDeck(userId: string, deckId: string): Promise<DeckDto>;
  deleteDeck(userId: string, deckId: string): Promise<void>;
}

interface DeckControllerDeps {
  services: () => Promise<{ decks: DecksServicePort }>;
}

const DEFAULT_DEPS: DeckControllerDeps = {
  services: buildDecksServices,
};

const VALID_LIST_STATUSES = new Set<string>(['available', 'archived']);

function getDeckIdParam(event: APIGatewayProxyEvent): string | null {
  const deckId = event.pathParameters?.deckId ?? '';
  return deckId && isValidUuid(deckId) ? deckId : null;
}

export async function createDeck(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateDeckRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateDeckRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { decks } = await deps.services();
    const deck = await decks.createDeck(payload.sub, body);
    return successResponse({ success: true, data: deck }, 201);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export async function listDecks(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const statusParam = event.queryStringParameters?.status ?? 'available';
  if (!VALID_LIST_STATUSES.has(statusParam)) {
    return errorResponse('status must be one of: available, archived', 400);
  }

  try {
    const { decks } = await deps.services();
    const result = await decks.listDecks(payload.sub, statusParam as DeckListStatus);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export async function getDeck(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  try {
    const { decks } = await deps.services();
    const deck = await decks.getDeck(payload.sub, deckId);
    return successResponse({ success: true, data: deck }, 200);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export async function updateDeck(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  let body: UpdateDeckRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateDeckRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { decks } = await deps.services();
    const deck = await decks.updateDeck(payload.sub, deckId, body);
    return successResponse({ success: true, data: deck }, 200);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export async function archiveDeck(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  try {
    const { decks } = await deps.services();
    const deck = await decks.archiveDeck(payload.sub, deckId);
    return successResponse({ success: true, data: deck }, 200);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export async function unarchiveDeck(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  try {
    const { decks } = await deps.services();
    const deck = await decks.unarchiveDeck(payload.sub, deckId);
    return successResponse({ success: true, data: deck }, 200);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export async function deleteDeck(
  event: APIGatewayProxyEvent,
  deps: DeckControllerDeps = DEFAULT_DEPS,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const deckId = getDeckIdParam(event);
  if (deckId === null) return errorResponse('Invalid or missing deckId', 400);

  try {
    const { decks } = await deps.services();
    await decks.deleteDeck(payload.sub, deckId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(mapDeckError(err));
  }
}

export type { DeckControllerDeps, DecksServicePort };
