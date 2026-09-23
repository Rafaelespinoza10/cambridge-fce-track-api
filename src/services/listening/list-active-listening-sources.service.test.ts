import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { ListActiveListeningSourcesService } from './list-active-listening-sources.service';

describe('ListActiveListeningSourcesService.execute', () => {
  it('delegates straight to the repository', async () => {
    const sources = [
      {
        id: 's1',
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
      },
    ];
    const service = new ListActiveListeningSourcesService({
      repository: { listActiveSources: async () => sources },
    });
    const result = await service.execute();
    assert.deepEqual(result, sources);
  });
});
