import 'reflect-metadata';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { errorResponse, successResponse, handleError, isValidUuid } from '@lib/shared/response';
import { getAuthenticatedPayload } from '@lib/shared/jwt';
import { mapResourceError } from '@lib/resources/resource-error-mapper';
import { buildResourcesServices } from '../services/resources/resources-composition';
import type {
  CreateResourceRequestBody,
  ResourceDto,
  UpdateResourceRequestBody,
} from '../interfaces/resources/resources.interface';

interface ResourcesServicePort {
  listResources(userId: string): Promise<ResourceDto[]>;
  createResource(userId: string, input: CreateResourceRequestBody): Promise<ResourceDto>;
  deleteResource(userId: string, resourceId: string): Promise<void>;
  updateResource(
    userId: string,
    resourceId: string,
    input: UpdateResourceRequestBody,
  ): Promise<ResourceDto>;
}

interface ResourceControllerDeps {
  services: () => Promise<{ resources: ResourcesServicePort }>;
}

const DEFAULT_DEPS: ResourceControllerDeps = {
  services: buildResourcesServices,
};

function getResourceIdParam(event: APIGatewayProxyEvent): string | null {
  const resourceId = event.pathParameters?.resourceId ?? '';
  return resourceId && isValidUuid(resourceId) ? resourceId : null;
}

async function listResourcesHandler(
  event: APIGatewayProxyEvent,
  deps: ResourceControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  try {
    const { resources } = await deps.services();
    const result = await resources.listResources(payload.sub);
    return successResponse({ success: true, data: result }, 200);
  } catch (err: unknown) {
    return handleError(mapResourceError(err));
  }
}

export async function listResources(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return listResourcesHandler(event, DEFAULT_DEPS);
}

async function createResourceHandler(
  event: APIGatewayProxyEvent,
  deps: ResourceControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  let body: CreateResourceRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as CreateResourceRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { resources } = await deps.services();
    const resource = await resources.createResource(payload.sub, body);
    return successResponse({ success: true, data: resource }, 201);
  } catch (err: unknown) {
    return handleError(mapResourceError(err));
  }
}

export async function createResource(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return createResourceHandler(event, DEFAULT_DEPS);
}

async function deleteResourceHandler(
  event: APIGatewayProxyEvent,
  deps: ResourceControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const resourceId = getResourceIdParam(event);
  if (resourceId === null) return errorResponse('Invalid or missing resourceId', 400);

  try {
    const { resources } = await deps.services();
    await resources.deleteResource(payload.sub, resourceId);
    return successResponse({ success: true }, 200);
  } catch (err: unknown) {
    return handleError(mapResourceError(err));
  }
}

export async function deleteResource(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return deleteResourceHandler(event, DEFAULT_DEPS);
}

async function updateResourceHandler(
  event: APIGatewayProxyEvent,
  deps: ResourceControllerDeps,
): Promise<APIGatewayProxyResult> {
  const payload = getAuthenticatedPayload(event);
  if (payload === null) return errorResponse('Unauthorized', 401);

  const resourceId = getResourceIdParam(event);
  if (resourceId === null) return errorResponse('Invalid or missing resourceId', 400);

  let body: UpdateResourceRequestBody;
  try {
    body = JSON.parse(event.body ?? '{}') as UpdateResourceRequestBody;
  } catch {
    return errorResponse('Invalid request body', 400);
  }

  try {
    const { resources } = await deps.services();
    const resource = await resources.updateResource(payload.sub, resourceId, body);
    return successResponse({ success: true, data: resource }, 200);
  } catch (err: unknown) {
    return handleError(mapResourceError(err));
  }
}

export async function updateResource(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return updateResourceHandler(event, DEFAULT_DEPS);
}

export {
  listResourcesHandler,
  createResourceHandler,
  deleteResourceHandler,
  updateResourceHandler,
};
export type { ResourceControllerDeps, ResourcesServicePort };
