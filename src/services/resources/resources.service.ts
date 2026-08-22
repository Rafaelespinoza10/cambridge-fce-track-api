import type { DataSource, UpdateResult } from 'typeorm';

import { ResourcesRepository } from '@repositories/resources/resources.repository';
import type { CreateResourceData, UpdateResourceData } from '@repositories/resources/resources.repository';
import type { Resource } from '../../models/Resource';
import type { ResourceType } from '../../models/enums';
import type {
  CreateResourceRequestBody,
  ResourceDto,
  UpdateResourceRequestBody,
} from '../../interfaces/resources/resources.interface';

export enum ResourceErrorCode {
  INVALID_INPUT = 'invalid_input',
  RESOURCE_NOT_FOUND = 'resource_not_found',
  RESOURCE_NOT_DELETABLE = 'resource_not_deletable',
  RESOURCE_NOT_EDITABLE = 'resource_not_editable',
}

export class ResourceError extends Error {
  constructor(
    message: string,
    readonly code: ResourceErrorCode,
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}

interface ResourcesRepositoryPort {
  findGlobalLinks(): Promise<Resource[]>;
  findByUserId(userId: string): Promise<Resource[]>;
  findByUserIdAndType(userId: string, resourceType: ResourceType): Promise<Resource[]>;
  create(data: CreateResourceData): Promise<Resource>;
  findActiveById(resourceId: string): Promise<Resource | null>;
  softDelete(resourceId: string, userId: string): Promise<UpdateResult>;
  update(resourceId: string, userId: string, data: UpdateResourceData): Promise<UpdateResult>;
}

interface ResourcesServiceDeps {
  resources: (dataSource: DataSource) => ResourcesRepositoryPort;
}

const DEFAULT_DEPS: ResourcesServiceDeps = {
  resources: (dataSource) => new ResourcesRepository(dataSource),
};

const TITLE_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 1000;
const URL_MAX_LENGTH = 2000;
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ResourceError('title must be a string', ResourceErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new ResourceError('title must not be empty', ResourceErrorCode.INVALID_INPUT);
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    throw new ResourceError(
      `title must be at most ${TITLE_MAX_LENGTH} characters`,
      ResourceErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== 'string') {
    throw new ResourceError('description must be a string', ResourceErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
    throw new ResourceError(
      `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
      ResourceErrorCode.INVALID_INPUT,
    );
  }
  return trimmed;
}

function normalizeImageUrl(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ResourceError('imageUrl must be a string', ResourceErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ResourceError('imageUrl must be a valid URL', ResourceErrorCode.INVALID_INPUT);
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new ResourceError('imageUrl must use http or https', ResourceErrorCode.INVALID_INPUT);
  }
  return trimmed;
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ResourceError('url must be a string', ResourceErrorCode.INVALID_INPUT);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new ResourceError('url must not be empty', ResourceErrorCode.INVALID_INPUT);
  }
  if (trimmed.length > URL_MAX_LENGTH) {
    throw new ResourceError(
      `url must be at most ${URL_MAX_LENGTH} characters`,
      ResourceErrorCode.INVALID_INPUT,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ResourceError('url must be a valid URL', ResourceErrorCode.INVALID_INPUT);
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new ResourceError('url must use http or https', ResourceErrorCode.INVALID_INPUT);
  }
  return trimmed;
}

function toResourceDto(resource: Resource): ResourceDto {
  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    url: resource.url ?? '',
    resourceType: resource.resource_type,
    imageUrl: resource.image_url ?? null,
    isGlobal: resource.is_global,
    createdAt: resource.created_at,
  };
}

class ResourcesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deps: ResourcesServiceDeps = DEFAULT_DEPS,
  ) {}

  private resourcesRepo(): ResourcesRepositoryPort {
    return this.deps.resources(this.dataSource);
  }

  async listResources(userId: string): Promise<ResourceDto[]> {
    const [globalLinks, personalLinks] = await Promise.all([
      this.resourcesRepo().findGlobalLinks(),
      this.resourcesRepo().findByUserId(userId),
    ]);
    return [...globalLinks, ...personalLinks].map(toResourceDto);
  }

  async listResourcesByType(userId: string, resourceType: ResourceType): Promise<ResourceDto[]> {
    const resources = await this.resourcesRepo().findByUserIdAndType(userId, resourceType);
    return resources.map(toResourceDto);
  }

  async createResource(userId: string, input: CreateResourceRequestBody): Promise<ResourceDto> {
    const title = normalizeTitle(input.title);
    const description =
      input.description === undefined ? null : normalizeDescription(input.description);
    const url = normalizeUrl(input.url);
    const imageUrl = normalizeImageUrl(input.imageUrl);
    const resourceType = input.resourceType;

    const resource = await this.resourcesRepo().create({
      userId,
      title,
      description,
      url,
      resourceType,
      imageUrl,
    });
    return toResourceDto(resource);
  }

  async deleteResource(userId: string, resourceId: string): Promise<void> {
    const resource = await this.resourcesRepo().findActiveById(resourceId);
    if (resource === null) {
      throw new ResourceError('Resource not found', ResourceErrorCode.RESOURCE_NOT_FOUND);
    }
    if (resource.is_global || resource.user_id !== userId) {
      throw new ResourceError(
        'You cannot delete this resource',
        ResourceErrorCode.RESOURCE_NOT_DELETABLE,
      );
    }

    const result = await this.resourcesRepo().softDelete(resourceId, userId);
    if (result.affected !== 1) {
      throw new ResourceError('Resource not found', ResourceErrorCode.RESOURCE_NOT_FOUND);
    }
  }

  async updateResource(
    userId: string,
    resourceId: string,
    input: UpdateResourceRequestBody,
  ): Promise<ResourceDto> {
    const resource = await this.resourcesRepo().findActiveById(resourceId);
    if (resource === null) {
      throw new ResourceError('Resource not found', ResourceErrorCode.RESOURCE_NOT_FOUND);
    }
    if (resource.is_global || resource.user_id !== userId) {
      throw new ResourceError(
        'You cannot edit this resource',
        ResourceErrorCode.RESOURCE_NOT_EDITABLE,
      );
    }

    const data: UpdateResourceData = {
      ...(input.title !== undefined && { title: normalizeTitle(input.title) }),
      ...(input.description !== undefined && {
        description: normalizeDescription(input.description),
      }),
      ...(input.url !== undefined && { url: normalizeUrl(input.url) }),
      ...(input.imageUrl !== undefined && { imageUrl: normalizeImageUrl(input.imageUrl) }),
    };

    if (Object.keys(data).length === 0) {
      throw new ResourceError('No fields to update', ResourceErrorCode.INVALID_INPUT);
    }

    const result = await this.resourcesRepo().update(resourceId, userId, data);
    if (result.affected !== 1) {
      throw new ResourceError('Resource not found', ResourceErrorCode.RESOURCE_NOT_FOUND);
    }

    const updated = await this.resourcesRepo().findActiveById(resourceId);
    if (updated === null) {
      throw new ResourceError('Resource not found', ResourceErrorCode.RESOURCE_NOT_FOUND);
    }
    return toResourceDto(updated);
  }
}

export { ResourcesService };
export type { ResourcesRepositoryPort, ResourcesServiceDeps };
