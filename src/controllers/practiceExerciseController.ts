import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapGeneratePracticeExerciseError } from '@lib/generate-practice-exercise-error-mapper';
import { mapPracticeExerciseError } from '@lib/practice-exercise-error-mapper';
import { buildPracticeExerciseServices } from '../services/practice/generate-practice-exercise-composition';
import type {
  GeneratePracticeExerciseRequest,
  PracticeExerciseSafeWithItems,
} from '../interfaces/practice/practice-exercise.interface';

interface GenerateExerciseServicePort {
  execute(
    userId: string,
    input: GeneratePracticeExerciseRequest,
  ): Promise<PracticeExerciseSafeWithItems>;
}

interface GetExerciseServicePort {
  getExercise(userId: string, exerciseId: string): Promise<PracticeExerciseSafeWithItems>;
}

interface PracticeExerciseControllerDeps {
  services: () => Promise<{
    generateExercise: GenerateExerciseServicePort;
    getExercise: GetExerciseServicePort;
  }>;
}

const DEFAULT_DEPS: PracticeExerciseControllerDeps = {
  services: buildPracticeExerciseServices,
};

function getExerciseIdParam(event: APIGatewayProxyEvent): string | null {
  const exerciseId = event.pathParameters?.exerciseId ?? '';
  return exerciseId && isValidUuid(exerciseId) ? exerciseId : null;
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

async function generatePracticeExerciseHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeExerciseControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GeneratePracticeExerciseRequest;
  try {
    body = JSON.parse(event.body ?? '{}') as GeneratePracticeExerciseRequest;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { generateExercise } = await deps.services();
    // Only these 4 fields are ever forwarded — unknown fields (including a
    // client-supplied userId) are structurally ignored.
    const exercise = await generateExercise.execute(payload.sub, {
      examCode: body.examCode,
      paperCode: body.paperCode,
      partCode: body.partCode,
      taskType: body.taskType,
      targetLevel: body.targetLevel,
    });
    return successResponse({ success: true, data: exercise }, 201);
  } catch (err: unknown) {
    return handleError(mapGeneratePracticeExerciseError(err));
  }
}

export async function generatePracticeExercise(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generatePracticeExerciseHandler(event, DEFAULT_DEPS);
}

async function getPracticeExerciseHandler(
  event: APIGatewayProxyEvent,
  deps: PracticeExerciseControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const exerciseId = getExerciseIdParam(event);
  if (exerciseId === null) return errorResponse('Invalid or missing exerciseId', 400);

  try {
    const { getExercise } = await deps.services();
    const exercise = await getExercise.getExercise(payload.sub, exerciseId);
    return successResponse({ success: true, data: exercise }, 200);
  } catch (err: unknown) {
    return handleError(mapPracticeExerciseError(err));
  }
}

export async function getPracticeExercise(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getPracticeExerciseHandler(event, DEFAULT_DEPS);
}

export { generatePracticeExerciseHandler, getPracticeExerciseHandler };
export type { PracticeExerciseControllerDeps, GenerateExerciseServicePort, GetExerciseServicePort };
