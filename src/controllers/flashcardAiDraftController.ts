import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapGenerateFlashcardDraftError } from '@lib/generate-flashcard-draft-error-mapper';
import { buildGenerateFlashcardDraftServices } from '../services/flashcards/generate-flashcard-draft-composition';
import type {
  GenerateFlashcardDraftRequest,
  GeneratedFlashcardDraftDto,
} from '../interfaces/flashcards/generate-flashcard-draft.interface';

interface GenerateFlashcardDraftServicePort {
  execute(input: GenerateFlashcardDraftRequest): Promise<GeneratedFlashcardDraftDto>;
}

interface FlashcardAiDraftControllerDeps {
  services: () => Promise<{ generateDraft: GenerateFlashcardDraftServicePort }>;
}

const DEFAULT_DEPS: FlashcardAiDraftControllerDeps = {
  services: buildGenerateFlashcardDraftServices,
};

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

async function generateFlashcardDraftHandler(
  event: APIGatewayProxyEvent,
  deps: FlashcardAiDraftControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GenerateFlashcardDraftRequest;
  try {
    body = JSON.parse(event.body ?? '{}') as GenerateFlashcardDraftRequest;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { generateDraft } = await deps.services();
    // Only term/type are ever forwarded — unknown fields (including a
    // client-supplied userId or scheduling data) are structurally ignored.
    const draft = await generateDraft.execute({ term: body.term, type: body.type });
    return successResponse({ success: true, data: draft }, 200);
  } catch (err: unknown) {
    return handleError(mapGenerateFlashcardDraftError(err));
  }
}

export async function generateFlashcardDraft(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateFlashcardDraftHandler(event, DEFAULT_DEPS);
}

export { generateFlashcardDraftHandler };
export type { FlashcardAiDraftControllerDeps, GenerateFlashcardDraftServicePort };
