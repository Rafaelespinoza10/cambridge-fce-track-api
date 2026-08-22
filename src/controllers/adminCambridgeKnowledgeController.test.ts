process.env.JWT_SECRET = 'test-secret-for-admin-cambridge-knowledge-controller';

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

import {
  importCambridgeSourceHandler,
  listCambridgeSourcesHandler,
  searchCambridgeKnowledgeHandler,
} from './adminCambridgeKnowledgeController';
import type { AdminCambridgeKnowledgeControllerDeps } from './adminCambridgeKnowledgeController';
import { JwtService } from '@lib/shared/jwt';
import { UserRole } from '../models/enums';
import {
  ImportCambridgeKnowledgeError,
  ImportCambridgeKnowledgeErrorCode,
} from '../services/cambridge-knowledge/import-cambridge-knowledge.service';

const ADMIN_TOKEN = JwtService.sign({
  sub: 'admin-1',
  email: 'admin@example.com',
  role: UserRole.ADMIN,
});
const STUDENT_TOKEN = JwtService.sign({
  sub: 'student-1',
  email: 'student@example.com',
  role: UserRole.STUDENT,
});

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: null,
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

function parseBody(result: APIGatewayProxyResult): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

type ResolvedServices = Awaited<ReturnType<AdminCambridgeKnowledgeControllerDeps['services']>>;

function makeDeps(overrides: Partial<ResolvedServices> = {}) {
  let importCalls = 0;
  let listCalls = 0;
  let searchCalls: unknown[] = [];

  const deps: AdminCambridgeKnowledgeControllerDeps = {
    services: async () => ({
      importKnowledge: {
        execute: async (input) => {
          importCalls++;
          return {
            source: {
              id: 'source-1',
              name: input.name,
              description: input.description,
              version: input.version,
              status: 'active' as never,
              pageCount: 3,
              createdAt: new Date('2026-01-01T00:00:00Z'),
              updatedAt: new Date('2026-01-01T00:00:00Z'),
            },
            chunkCount: 5,
            idempotentReplay: false,
          };
        },
      },
      listSources: {
        execute: async () => {
          listCalls++;
          return [];
        },
      },
      searchKnowledge: {
        execute: async (filters) => {
          searchCalls.push(filters);
          return [];
        },
      },
      ...overrides,
    }),
  } as AdminCambridgeKnowledgeControllerDeps;

  return {
    deps,
    getImportCalls: () => importCalls,
    getListCalls: () => listCalls,
    getSearchCalls: () => searchCalls,
  };
}

const VALID_IMPORT_BODY = JSON.stringify({
  name: 'B2 First Handbook',
  description: 'Official handbook',
  version: '2024',
  fileBase64: Buffer.from('%PDF-1.4 fake').toString('base64'),
});

describe('admin isolation — every handler rejects non-admin callers identically to unauthenticated ones', () => {
  it('importCambridgeSourceHandler: 401 with no Authorization header, service never called', async () => {
    const { deps, getImportCalls } = makeDeps();
    const event = makeEvent({ headers: {}, body: VALID_IMPORT_BODY });

    const result = await importCambridgeSourceHandler(event, deps);

    assert.equal(result.statusCode, 401);
    assert.equal(getImportCalls(), 0);
  });

  it('importCambridgeSourceHandler: 401 for an authenticated non-admin (student) caller', async () => {
    const { deps, getImportCalls } = makeDeps();
    const event = makeEvent({
      headers: { Authorization: `Bearer ${STUDENT_TOKEN}` },
      body: VALID_IMPORT_BODY,
    });

    const result = await importCambridgeSourceHandler(event, deps);

    assert.equal(result.statusCode, 401);
    assert.equal(getImportCalls(), 0);
  });

  it('listCambridgeSourcesHandler: 401 for a student, service never called', async () => {
    const { deps, getListCalls } = makeDeps();
    const event = makeEvent({ headers: { Authorization: `Bearer ${STUDENT_TOKEN}` } });

    const result = await listCambridgeSourcesHandler(event, deps);

    assert.equal(result.statusCode, 401);
    assert.equal(getListCalls(), 0);
  });

  it('searchCambridgeKnowledgeHandler: 401 for a student, service never called', async () => {
    const { deps, getSearchCalls } = makeDeps();
    const event = makeEvent({
      headers: { Authorization: `Bearer ${STUDENT_TOKEN}` },
      body: JSON.stringify({ query: 'grammar' }),
    });

    const result = await searchCambridgeKnowledgeHandler(event, deps);

    assert.equal(result.statusCode, 401);
    assert.equal(getSearchCalls().length, 0);
  });
});

describe('importCambridgeSourceHandler (admin)', () => {
  it('imports successfully with a valid admin request', async () => {
    const { deps, getImportCalls } = makeDeps();
    const event = makeEvent({ body: VALID_IMPORT_BODY });

    const result = await importCambridgeSourceHandler(event, deps);

    assert.equal(result.statusCode, 201);
    assert.equal(getImportCalls(), 1);
    const body = parseBody(result);
    assert.equal(body.success, true);
  });

  it('returns 200 (not 201) for an idempotent replay', async () => {
    const { deps } = makeDeps({
      importKnowledge: {
        execute: async () => ({
          source: {
            id: 'source-1',
            name: 'x',
            description: null,
            version: '1',
            status: 'active' as never,
            pageCount: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          chunkCount: 0,
          idempotentReplay: true,
        }),
      },
    });
    const event = makeEvent({ body: VALID_IMPORT_BODY });

    const result = await importCambridgeSourceHandler(event, deps);

    assert.equal(result.statusCode, 200);
  });

  it('rejects a request missing fileBase64 with 400, without calling the service', async () => {
    const { deps, getImportCalls } = makeDeps();
    const event = makeEvent({
      body: JSON.stringify({ name: 'Handbook', version: '1.0' }),
    });

    const result = await importCambridgeSourceHandler(event, deps);

    assert.equal(result.statusCode, 400);
    assert.equal(getImportCalls(), 0);
  });

  it('maps a service error code to its documented HTTP status', async () => {
    const { deps } = makeDeps({
      importKnowledge: {
        execute: async () => {
          throw new ImportCambridgeKnowledgeError(
            'rate limited',
            ImportCambridgeKnowledgeErrorCode.AI_RATE_LIMITED,
          );
        },
      },
    });
    const event = makeEvent({ body: VALID_IMPORT_BODY });

    const result = await importCambridgeSourceHandler(event, deps);

    assert.equal(result.statusCode, 429);
  });
});

describe('listCambridgeSourcesHandler (admin)', () => {
  it('returns the sources list for an admin caller', async () => {
    const { deps, getListCalls } = makeDeps();
    const event = makeEvent();

    const result = await listCambridgeSourcesHandler(event, deps);

    assert.equal(result.statusCode, 200);
    assert.equal(getListCalls(), 1);
  });
});

describe('searchCambridgeKnowledgeHandler (admin)', () => {
  it('forwards query/paperCode/partCode/skill/topic/limit to the service', async () => {
    const { deps, getSearchCalls } = makeDeps();
    const event = makeEvent({
      body: JSON.stringify({
        query: 'grammar',
        paperCode: 'PAPER_1',
        partCode: 'UOE_PART_2',
        skill: 'use-of-english',
        topic: 'travel and tourism',
        limit: 5,
      }),
    });

    const result = await searchCambridgeKnowledgeHandler(event, deps);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(getSearchCalls()[0], {
      query: 'grammar',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_2',
      skill: 'use-of-english',
      topic: 'travel and tourism',
      limit: 5,
    });
  });

  it('treats a blank query as absent rather than forwarding an empty string', async () => {
    const { deps, getSearchCalls } = makeDeps();
    const event = makeEvent({ body: JSON.stringify({ query: '   ' }) });

    await searchCambridgeKnowledgeHandler(event, deps);

    assert.equal((getSearchCalls()[0] as { query?: string }).query, undefined);
  });
});
