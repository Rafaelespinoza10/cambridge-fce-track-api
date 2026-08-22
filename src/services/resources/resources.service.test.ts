import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { DataSource, UpdateResult } from 'typeorm';

import { ResourcesService, ResourceError, ResourceErrorCode } from './resources.service';
import type { ResourcesRepositoryPort, ResourcesServiceDeps } from './resources.service';
import type { Resource } from '../../models/Resource';
import { ResourceType } from '../../models/enums';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const RESOURCE_ID = 'resource-1';
const NOW = new Date('2026-01-15T00:00:00.000Z');

const OK_RESULT: UpdateResult = { affected: 1, raw: [], generatedMaps: [] };
const NO_MATCH_RESULT: UpdateResult = { affected: 0, raw: [], generatedMaps: [] };

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: RESOURCE_ID,
    user_id: USER_ID,
    title: 'Flo-Joe',
    description: 'B2 First exam practice',
    resource_type: ResourceType.LINK,
    url: 'https://www.flo-joe.co.uk/fce/',
    storage_key: null,
    image_url: null,
    is_global: false,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...overrides,
  } as Resource;
}

interface World {
  resources: Resource[];
}

function createWorld(overrides: Partial<World> = {}): World {
  return { resources: [], ...overrides };
}

let idCounter = 0;

function buildFakeResourcesRepo(world: World): ResourcesRepositoryPort {
  return {
    findGlobalLinks: async () =>
      world.resources.filter((r) => r.is_global && r.deleted_at === null),
    findByUserId: async (userId) =>
      world.resources.filter((r) => r.user_id === userId && !r.is_global && r.deleted_at === null),
    findByUserIdAndType: async (userId, resourceType) =>
      world.resources.filter(
        (r) => r.user_id === userId && r.resource_type === resourceType && r.deleted_at === null,
      ),
    create: async (data) => {
      idCounter += 1;
      const resource = makeResource({
        id: `created-${idCounter}`,
        user_id: data.userId,
        title: data.title,
        description: data.description,
        url: data.url,
        resource_type: data.resourceType ?? ResourceType.LINK,
        image_url: data.imageUrl ?? null,
        is_global: false,
      });
      world.resources.push(resource);
      return resource;
    },
    findActiveById: async (resourceId) => {
      const found = world.resources.find((r) => r.id === resourceId && r.deleted_at === null);
      return found ?? null;
    },
    softDelete: async (resourceId, userId) => {
      const resource = world.resources.find(
        (r) => r.id === resourceId && r.user_id === userId && r.deleted_at === null,
      );
      if (resource === undefined) return NO_MATCH_RESULT;
      resource.deleted_at = new Date();
      return OK_RESULT;
    },
  };
}

function setup(worldOverrides: Partial<World> = {}) {
  const world = createWorld(worldOverrides);
  const resourcesRepo = buildFakeResourcesRepo(world);
  const deps: ResourcesServiceDeps = { resources: () => resourcesRepo };
  const service = new ResourcesService({} as DataSource, deps);
  return { world, resourcesRepo, service };
}

function isInvalidInput(error: unknown): boolean {
  return error instanceof ResourceError && error.code === ResourceErrorCode.INVALID_INPUT;
}

describe('ResourcesService.listResources', () => {
  it('returns global links and the user personal links, but not other users’ links', async () => {
    const { service } = setup({
      resources: [
        makeResource({ id: 'g1', user_id: null, is_global: true }),
        makeResource({ id: 'p1', user_id: USER_ID, is_global: false }),
        makeResource({ id: 'p2', user_id: OTHER_USER_ID, is_global: false }),
      ],
    });
    const result = await service.listResources(USER_ID);
    assert.deepEqual(result.map((r) => r.id).sort(), ['g1', 'p1']);
  });

  it('excludes soft-deleted resources', async () => {
    const { service } = setup({
      resources: [makeResource({ id: 'g1', user_id: null, is_global: true, deleted_at: NOW })],
    });
    const result = await service.listResources(USER_ID);
    assert.deepEqual(result, []);
  });
});

describe('ResourcesService.createResource', () => {
  it('creates a personal link resource with normalized fields', async () => {
    const { service } = setup();
    const resource = await service.createResource(USER_ID, {
      title: '  My link  ',
      url: 'https://example.com/practice',
      description: '  notes  ',
    });
    assert.equal(resource.title, 'My link');
    assert.equal(resource.url, 'https://example.com/practice');
    assert.equal(resource.description, 'notes');
    assert.equal(resource.isGlobal, false);
    assert.equal(resource.resourceType, ResourceType.LINK);
  });

  it('treats an empty description as null', async () => {
    const { service } = setup();
    const resource = await service.createResource(USER_ID, {
      title: 'Link',
      url: 'https://example.com',
      description: '   ',
    });
    assert.equal(resource.description, null);
  });

  it('rejects an empty title', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createResource(USER_ID, { title: '  ', url: 'https://example.com' }),
      isInvalidInput,
    );
  });

  it('rejects a malformed url', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createResource(USER_ID, { title: 'Link', url: 'not a url' }),
      isInvalidInput,
    );
  });

  it('rejects a non-http(s) url protocol', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.createResource(USER_ID, { title: 'Link', url: 'javascript:alert(1)' }),
      isInvalidInput,
    );
  });
});

describe('ResourcesService.deleteResource', () => {
  it('deletes a personal link belonging to the user', async () => {
    const { world, service } = setup({
      resources: [makeResource({ user_id: USER_ID, is_global: false })],
    });
    await service.deleteResource(USER_ID, RESOURCE_ID);
    assert.notEqual(world.resources[0].deleted_at, null);
  });

  it('rejects deleting a global resource', async () => {
    const { service } = setup({
      resources: [makeResource({ user_id: null, is_global: true })],
    });
    await assert.rejects(
      () => service.deleteResource(USER_ID, RESOURCE_ID),
      (error: unknown) =>
        error instanceof ResourceError && error.code === ResourceErrorCode.RESOURCE_NOT_DELETABLE,
    );
  });

  it("rejects deleting another user's personal resource", async () => {
    const { service } = setup({
      resources: [makeResource({ user_id: OTHER_USER_ID, is_global: false })],
    });
    await assert.rejects(
      () => service.deleteResource(USER_ID, RESOURCE_ID),
      (error: unknown) =>
        error instanceof ResourceError && error.code === ResourceErrorCode.RESOURCE_NOT_DELETABLE,
    );
  });

  it('rejects deleting a nonexistent resource', async () => {
    const { service } = setup();
    await assert.rejects(
      () => service.deleteResource(USER_ID, 'missing'),
      (error: unknown) =>
        error instanceof ResourceError && error.code === ResourceErrorCode.RESOURCE_NOT_FOUND,
    );
  });
});
