import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/response';
import { getAuthenticatedPayload } from '@lib/jwt';
import { mapGenerateWritingTaskError } from '@lib/generate-writing-task-error-mapper';
import { mapWritingTaskError } from '@lib/writing-task-error-mapper';
import { buildWritingTaskServices } from '../services/writing/generate-writing-task-composition';
import type {
  GenerateWritingTaskRequest,
  WritingTaskSafeDto,
} from '../interfaces/writing/writing-task.interface';

interface GenerateTaskServicePort {
  execute(userId: string, input: GenerateWritingTaskRequest): Promise<WritingTaskSafeDto>;
}

interface GetTaskServicePort {
  getTask(userId: string, taskId: string): Promise<WritingTaskSafeDto>;
}

interface WritingTaskControllerDeps {
  services: () => Promise<{
    generateTask: GenerateTaskServicePort;
    getTask: GetTaskServicePort;
  }>;
}

const DEFAULT_DEPS: WritingTaskControllerDeps = {
  services: buildWritingTaskServices,
};

function getTaskIdParam(event: APIGatewayProxyEvent): string | null {
  const taskId = event.pathParameters?.taskId ?? '';
  return taskId && isValidUuid(taskId) ? taskId : null;
}

// AWS Lambda always invokes the exported handler as `handler(event, context)`,
// so a second parameter with a default value (`deps = DEFAULT_DEPS`) never
// falls back to the default in production — `context` is a real object, not
// `undefined`. Each handler below takes `deps` explicitly (only ever supplied
// by tests); the exported Lambda entry point takes just `event` and always
// wires in DEFAULT_DEPS itself.

// ── POST /writing/tasks ───────────────────────────────────────────────────────

async function generateWritingTaskHandler(
  event: APIGatewayProxyEvent,
  deps: WritingTaskControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: GenerateWritingTaskRequest;
  try {
    body = JSON.parse(event.body ?? '{}') as GenerateWritingTaskRequest;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { generateTask } = await deps.services();
    // Only these fields are ever forwarded — unknown fields (including a
    // client-supplied userId) are structurally ignored.
    const task = await generateTask.execute(payload.sub, {
      taskType: body.taskType,
      targetLevel: body.targetLevel,
      idempotencyKey: body.idempotencyKey,
    });
    return successResponse({ success: true, data: task }, 201);
  } catch (err: unknown) {
    return handleError(mapGenerateWritingTaskError(err));
  }
}

export async function generateWritingTask(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return generateWritingTaskHandler(event, DEFAULT_DEPS);
}

// ── GET /writing/tasks/{taskId} ─────────────────────────────────────────────────

async function getWritingTaskHandler(
  event: APIGatewayProxyEvent,
  deps: WritingTaskControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const taskId = getTaskIdParam(event);
  if (taskId === null) return errorResponse('Invalid or missing taskId', 400);

  try {
    const { getTask } = await deps.services();
    const task = await getTask.getTask(payload.sub, taskId);
    return successResponse({ success: true, data: task }, 200);
  } catch (err: unknown) {
    return handleError(mapWritingTaskError(err));
  }
}

export async function getWritingTask(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return getWritingTaskHandler(event, DEFAULT_DEPS);
}

export { generateWritingTaskHandler, getWritingTaskHandler };
export type { WritingTaskControllerDeps, GenerateTaskServicePort, GetTaskServicePort };
