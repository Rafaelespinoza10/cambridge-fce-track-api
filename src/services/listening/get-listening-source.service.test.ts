import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GetListeningSourceService,
  GetListeningSourceError,
  GetListeningSourceErrorCode,
} from './get-listening-source.service';

const SOURCE_ID = '11111111-1111-1111-1111-111111111111';

describe('GetListeningSourceService.execute', () => {
  it('returns the source when active', async () => {
    const source = {
      id: SOURCE_ID,
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_4',
      partCode: 'LISTENING_PART_1',
      title: 't',
      instructions: 'i',
      targetLevel: null,
      videoProvider: 'youtube',
      videoExternalId: 'abc',
      videoStartSeconds: 0,
      videoEndSeconds: 60,
      status: 'active' as never,
      itemCount: 3,
      createdAt: new Date(),
    };
    const service = new GetListeningSourceService({
      repository: { findActiveByIdSafe: async () => source },
    });
    const result = await service.execute(SOURCE_ID);
    assert.equal(result.id, SOURCE_ID);
  });

  it('rejects a missing or inactive source', async () => {
    const service = new GetListeningSourceService({
      repository: { findActiveByIdSafe: async () => null },
    });
    await assert.rejects(
      () => service.execute(SOURCE_ID),
      (err: unknown) => {
        assert.ok(err instanceof GetListeningSourceError);
        assert.equal(err.code, GetListeningSourceErrorCode.SOURCE_NOT_FOUND);
        return true;
      },
    );
  });
});
