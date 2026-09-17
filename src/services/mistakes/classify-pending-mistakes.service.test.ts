import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ClassifyPendingMistakesService,
  ClassifyPendingMistakesError,
  AI_CLASSIFIABLE_TASK_TYPE,
} from './classify-pending-mistakes.service';
import type {
  LexicalClassifierPort,
  MistakesRepositoryPort,
} from './classify-pending-mistakes.service';
import { toClassification } from './classify-lexical-mistake';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type { MistakeClassificationResult } from '@lib/mistakes/mistake-classifier';
import { MistakeClassificationSource, MistakeErrorType } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';

function concept(overrides: Partial<MistakeConcept> = {}): MistakeConcept {
  return {
    id: 'concept-1',
    user_id: USER_ID,
    prompt: 'She ______ a decision without consulting anyone.',
    correct_answer: 'made',
    last_user_answer: 'did',
    task_type: AI_CLASSIFIABLE_TASK_TYPE,
    ...overrides,
  } as MistakeConcept;
}

const COLLOCATION: MistakeClassificationResult = {
  errorType: MistakeErrorType.COLLOCATION,
  errorSubtype: null,
  expectedWordClass: null,
  userWordClass: null,
  confidence: 0.7,
  classificationSource: MistakeClassificationSource.AI,
};

const UNKNOWN: MistakeClassificationResult = {
  errorType: MistakeErrorType.UNKNOWN,
  errorSubtype: null,
  expectedWordClass: null,
  userWordClass: null,
  confidence: 0,
  classificationSource: MistakeClassificationSource.UNKNOWN,
};

interface Calls {
  queries: Array<{ userId: string; taskType: string; limit: number }>;
  classified: Array<Record<string, unknown>>;
  writes: Array<Record<string, unknown>>;
}

function makeService(
  options: {
    pending?: MistakeConcept[];
    result?: MistakeClassificationResult;
    writeSucceeds?: boolean;
  } = {},
): { service: ClassifyPendingMistakesService; calls: Calls } {
  const calls: Calls = { queries: [], classified: [], writes: [] };

  const repository: MistakesRepositoryPort = {
    async findUnclassifiedForUser(userId, taskType, limit) {
      calls.queries.push({ userId, taskType, limit });
      return options.pending ?? [concept()];
    },
    async reclassify(data) {
      calls.writes.push(data as unknown as Record<string, unknown>);
      return options.writeSucceeds ?? true;
    },
  };

  const classifier: LexicalClassifierPort = {
    async classify(input) {
      calls.classified.push(input as unknown as Record<string, unknown>);
      return options.result ?? COLLOCATION;
    },
  };

  return {
    service: new ClassifyPendingMistakesService({ repository, classifier }),
    calls,
  };
}

describe('ClassifyPendingMistakesService', () => {
  it('classifies the pending mistakes and writes the result back', async () => {
    const { service, calls } = makeService();

    const result = await service.execute(USER_ID);

    assert.deepEqual(result, { examined: 1, classified: 1 });
    assert.equal(calls.writes[0].errorType, MistakeErrorType.COLLOCATION);
    assert.equal(calls.writes[0].classificationSource, MistakeClassificationSource.AI);
  });

  it('only ever looks at the one task type no rule can read', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID);

    assert.equal(calls.queries[0].taskType, AI_CLASSIFIABLE_TASK_TYPE);
  });

  it('caps how many it classifies in a single run — this is billable work', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID);

    assert.ok(calls.queries[0].limit <= 10, `limit was ${calls.queries[0].limit}`);
  });

  it('gives the model both answers so it can judge the distinction', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID);

    assert.equal(calls.classified[0].userAnswer, 'did');
    assert.equal(calls.classified[0].correctAnswer, 'made');
    assert.equal(calls.classified[0].prompt, 'She ______ a decision without consulting anyone.');
  });

  it('never writes back an unconfident answer', async () => {
    const { service, calls } = makeService({ result: UNKNOWN });

    const result = await service.execute(USER_ID);

    assert.deepEqual(result, { examined: 1, classified: 0 });
    assert.equal(calls.writes.length, 0, 'a no-op write is a wasted round trip');
  });

  it('does not count a concept the repository refused to update', async () => {
    // e.g. a human classified it between the read and the write.
    const { service } = makeService({ writeSucceeds: false });

    const result = await service.execute(USER_ID);

    assert.deepEqual(result, { examined: 1, classified: 0 });
  });

  it('is a no-op when there is nothing pending', async () => {
    const { service, calls } = makeService({ pending: [] });

    const result = await service.execute(USER_ID);

    assert.deepEqual(result, { examined: 0, classified: 0 });
    assert.equal(calls.classified.length, 0);
  });

  it('always scopes both the read and the write to the caller', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID);
    await service.execute(OTHER_USER_ID);

    assert.deepEqual(
      calls.queries.map((q) => q.userId),
      [USER_ID, OTHER_USER_ID],
    );
    assert.deepEqual(
      calls.writes.map((w) => w.userId),
      [USER_ID, OTHER_USER_ID],
    );
  });

  it('rejects a missing userId before touching anything', async () => {
    const { service, calls } = makeService();

    await assert.rejects(
      () => service.execute('   '),
      (err: unknown) => err instanceof ClassifyPendingMistakesError,
    );
    assert.equal(calls.queries.length, 0);
  });
});

describe('toClassification — trusting the model only when it is sure', () => {
  it('accepts a confident, known category', () => {
    const result = toClassification({ category: 'phrasal_verb', confident: true });

    assert.equal(result.errorType, MistakeErrorType.PHRASAL_VERB);
    assert.equal(result.classificationSource, MistakeClassificationSource.AI);
  });

  it('rejects an unconfident answer, however plausible', () => {
    const result = toClassification({ category: 'collocation', confident: false });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });

  it("honours the model's own 'unknown'", () => {
    const result = toClassification({ category: 'unknown', confident: true });

    assert.equal(result.errorType, MistakeErrorType.UNKNOWN);
  });

  it('never accepts a category outside the offered set', () => {
    for (const category of ['word_class', 'spelling', 'prefix_suffix', 'nonsense']) {
      const result = toClassification({ category, confident: true });
      assert.equal(result.errorType, MistakeErrorType.UNKNOWN, category);
    }
  });

  it('degrades a malformed response instead of throwing', () => {
    for (const raw of [null, undefined, 'text', 42, [], {}, { confident: true }]) {
      assert.equal(toClassification(raw).errorType, MistakeErrorType.UNKNOWN);
    }
  });

  it('never invents a subtype for Part 1', () => {
    const result = toClassification({ category: 'vocabulary', confident: true });

    assert.equal(result.errorSubtype, null);
  });
});
