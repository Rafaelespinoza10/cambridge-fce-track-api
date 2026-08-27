import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  ListMistakesService,
  ListMistakesError,
  ListMistakesErrorCode,
} from './list-mistakes.service';
import type { MistakesRepositoryPort } from './list-mistakes.service';
import type { ListMistakesFilters } from '@repositories/mistakes/mistakes.repository';
import type { MistakeConcept } from '../../models/MistakeConcept';
import {
  EnglishLevel,
  MistakeErrorType,
  MistakeErrorSubtype,
  MistakeSource,
  WordClass,
} from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const FIRST_SEEN_AT = new Date('2026-01-20T09:00:00.000Z');
const LAST_WRONG_AT = new Date('2026-02-01T10:00:00.000Z');

function makeConcept(overrides: Partial<MistakeConcept> = {}): MistakeConcept {
  return {
    id: 'concept-1',
    user_id: USER_ID,
    concept_key: 'uoe_part_3|responsible|responsibly',
    source: MistakeSource.PRACTICE_ATTEMPT,
    skill_slug: 'use-of-english',
    exam_code: 'B2_FIRST',
    paper_code: 'PAPER_1',
    part_code: 'UOE_PART_3',
    task_type: 'word_formation',
    base_word: 'RESPONSIBLE',
    prompt: 'Form a word from RESPONSIBLE to fit gap (1).',
    correct_answer: 'responsibly',
    last_user_answer: 'IRRESPONSIBLE',
    explanation: 'The gap needs an adverb.',
    target_level: EnglishLevel.B2,
    error_type: MistakeErrorType.UNKNOWN,
    error_subtype: null,
    expected_word_class: null,
    user_word_class: null,
    times_wrong: 2,
    times_correct: 1,
    first_seen_at: FIRST_SEEN_AT,
    last_wrong_at: LAST_WRONG_AT,
    last_correct_at: null,
    ...overrides,
  } as unknown as MistakeConcept;
}

function makeService(options: { rows?: MistakeConcept[]; totalItems?: number } = {}): {
  service: ListMistakesService;
  calls: ListMistakesFilters[];
} {
  const calls: ListMistakesFilters[] = [];
  const rows = options.rows ?? [makeConcept()];
  const repository: MistakesRepositoryPort = {
    async listByUser(filters) {
      calls.push(filters);
      return { rows, totalItems: options.totalItems ?? rows.length };
    },
  };
  return { service: new ListMistakesService({ repository }), calls };
}

function assertListErr(err: unknown, code: ListMistakesErrorCode): true {
  assert.ok(err instanceof ListMistakesError);
  assert.equal(err.code, code);
  return true;
}

describe('ListMistakesService.execute — mapping', () => {
  it('maps a concept to its DTO without ever exposing the owner id', async () => {
    const { service } = makeService();

    const result = await service.execute(USER_ID, {});

    assert.equal(result.items.length, 1);
    const [item] = result.items;
    assert.deepEqual(item, {
      mistakeId: 'concept-1',
      conceptKey: 'uoe_part_3|responsible|responsibly',
      source: MistakeSource.PRACTICE_ATTEMPT,
      skill: 'use-of-english',
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_3',
      taskType: 'word_formation',
      baseWord: 'RESPONSIBLE',
      prompt: 'Form a word from RESPONSIBLE to fit gap (1).',
      userAnswer: 'IRRESPONSIBLE',
      correctAnswer: 'responsibly',
      explanation: 'The gap needs an adverb.',
      targetLevel: EnglishLevel.B2,
      errorType: MistakeErrorType.UNKNOWN,
      errorSubtype: null,
      expectedWordClass: null,
      userWordClass: null,
      timesWrong: 2,
      timesCorrect: 1,
      firstSeenAt: FIRST_SEEN_AT,
      lastWrongAt: LAST_WRONG_AT,
      lastCorrectAt: null,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'userId'), false);
  });

  it('passes a classified concept through untouched', async () => {
    const { service } = makeService({
      rows: [
        makeConcept({
          error_type: MistakeErrorType.WORD_CLASS,
          error_subtype: MistakeErrorSubtype.ADJECTIVE_TO_ADVERB,
          expected_word_class: WordClass.ADVERB,
          user_word_class: WordClass.ADJECTIVE,
        }),
      ],
    });

    const { items } = await service.execute(USER_ID, {});

    assert.equal(items[0].errorType, MistakeErrorType.WORD_CLASS);
    assert.equal(items[0].errorSubtype, MistakeErrorSubtype.ADJECTIVE_TO_ADVERB);
    assert.equal(items[0].expectedWordClass, WordClass.ADVERB);
    assert.equal(items[0].userWordClass, WordClass.ADJECTIVE);
  });

  it('computes pagination and defaults to page 1 / 20 per page', async () => {
    const { service, calls } = makeService({ totalItems: 45 });

    const result = await service.execute(USER_ID, {});

    assert.deepEqual(result.pagination, {
      page: 1,
      pageSize: 20,
      totalItems: 45,
      totalPages: 3,
    });
    assert.equal(calls[0].page, 1);
    assert.equal(calls[0].pageSize, 20);
  });

  it('reports zero pages for an empty Mistake Bank', async () => {
    const { service } = makeService({ rows: [], totalItems: 0 });

    const result = await service.execute(USER_ID, {});

    assert.deepEqual(result.items, []);
    assert.equal(result.pagination.totalPages, 0);
  });
});

describe('ListMistakesService.execute — ownership', () => {
  it('always scopes the query to the caller, with no filter able to widen it', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, { skill: 'use-of-english' });
    await service.execute(OTHER_USER_ID, {});

    assert.equal(calls[0].userId, USER_ID);
    assert.equal(calls[1].userId, OTHER_USER_ID);
  });

  it('rejects a missing userId before reaching the repository', async () => {
    const { service, calls } = makeService();

    await assert.rejects(
      () => service.execute('   ', {}),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
    assert.equal(calls.length, 0);
  });
});

describe('ListMistakesService.execute — filters', () => {
  it('forwards every supported filter to the repository', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, {
      skill: 'use-of-english',
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_3',
      errorType: 'word_class',
      baseWord: 'RESPONSIBLE',
      page: '2',
      pageSize: '10',
    });

    assert.deepEqual(calls[0], {
      userId: USER_ID,
      skill: 'use-of-english',
      examCode: 'B2_FIRST',
      paperCode: 'PAPER_1',
      partCode: 'UOE_PART_3',
      errorType: MistakeErrorType.WORD_CLASS,
      baseWord: 'RESPONSIBLE',
      page: 2,
      pageSize: 10,
    });
  });

  it('accepts the shouted skill form and normalizes it to the seeded slug', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, { skill: 'USE_OF_ENGLISH' });

    assert.equal(calls[0].skill, 'use-of-english');
  });

  it('leaves every filter undefined when none is sent', async () => {
    const { service, calls } = makeService();

    await service.execute(USER_ID, {});

    assert.equal(calls[0].skill, undefined);
    assert.equal(calls[0].examCode, undefined);
    assert.equal(calls[0].errorType, undefined);
    assert.equal(calls[0].baseWord, undefined);
  });

  it('rejects an unknown skill', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { skill: 'maths' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.UNSUPPORTED_SKILL),
    );
  });

  it('rejects an unknown errorType', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { errorType: 'typo' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an empty baseWord', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { baseWord: '   ' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an unknown examCode', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { examCode: 'C2_PROFICIENCY' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.UNSUPPORTED_EXAM),
    );
  });

  it('rejects a partCode that does not belong to the given paper', async () => {
    const { service } = makeService();

    await assert.rejects(
      () =>
        service.execute(USER_ID, {
          examCode: 'B2_FIRST',
          paperCode: 'PAPER_1',
          partCode: 'LISTENING_PART_2',
        }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.UNSUPPORTED_PART),
    );
  });

  it('rejects a narrower catalog filter sent without its broader one', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { paperCode: 'PAPER_1' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { examCode: 'B2_FIRST', partCode: 'UOE_PART_3' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
  });

  it('rejects malformed or oversized pagination', async () => {
    const { service } = makeService();

    await assert.rejects(
      () => service.execute(USER_ID, { page: '0' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { pageSize: 'ten' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
    await assert.rejects(
      () => service.execute(USER_ID, { pageSize: '500' }),
      (err: unknown) => assertListErr(err, ListMistakesErrorCode.INVALID_INPUT),
    );
  });
});
