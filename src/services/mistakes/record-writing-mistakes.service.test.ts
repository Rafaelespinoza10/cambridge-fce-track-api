import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { EntityManager } from 'typeorm';

import {
  RecordWritingMistakesService,
  buildWritingConceptKey,
  partCodeForWritingTask,
} from './record-writing-mistakes.service';
import type { MistakesRepositoryPort } from './record-writing-mistakes.service';
import type { WritingCorrection } from '../../models/writing-json-types';
import {
  MistakeClassificationSource,
  MistakeErrorType,
  MistakeSource,
  WritingTaskType,
} from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SUBMISSION_ID = 'submission-1';
const GRADED_AT = new Date('2026-03-01T12:00:00.000Z');
const MANAGER = {} as EntityManager;

function correction(overrides: Partial<WritingCorrection> = {}): WritingCorrection {
  return {
    id: '0',
    originalExcerpt: 'I am agree with this',
    correctedExcerpt: 'I agree with this',
    explanation: '"Agree" is a verb, so it does not take "am".',
    category: 'grammar',
    ...overrides,
  };
}

interface Calls {
  concepts: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  wrongs: Array<Record<string, unknown>>;
}

function makeService(options: { duplicateOccurrence?: boolean } = {}): {
  service: RecordWritingMistakesService;
  calls: Calls;
} {
  const calls: Calls = { concepts: [], occurrences: [], wrongs: [] };
  const repository: MistakesRepositoryPort = {
    async ensureConcept(data) {
      calls.concepts.push(data as unknown as Record<string, unknown>);
      return `concept-${calls.concepts.length}`;
    },
    async createOccurrence(data) {
      calls.occurrences.push(data as unknown as Record<string, unknown>);
      return options.duplicateOccurrence === true ? null : `occurrence-${calls.occurrences.length}`;
    },
    async registerWrong(data) {
      calls.wrongs.push(data as unknown as Record<string, unknown>);
    },
  };
  return {
    service: new RecordWritingMistakesService({ repository: () => repository }),
    calls,
  };
}

describe('partCodeForWritingTask', () => {
  it('reads the exam part from the existing writing catalog, not a second mapping', () => {
    assert.equal(partCodeForWritingTask(WritingTaskType.ESSAY), 'WRITING_PART_1');
    assert.equal(partCodeForWritingTask(WritingTaskType.ARTICLE), 'WRITING_PART_2');
    assert.equal(partCodeForWritingTask(WritingTaskType.REPORT), 'WRITING_PART_2');
  });
});

describe('buildWritingConceptKey', () => {
  it('keys on what the student should have written, not on what they wrote', () => {
    const a = buildWritingConceptKey('WRITING_PART_1', 'grammar', 'I agree with this');
    const b = buildWritingConceptKey('WRITING_PART_1', 'grammar', 'I AGREE  with this ');

    assert.equal(a, b, 'normalization should make these the same concept');
    assert.equal(a, 'writing_part_1|grammar|i agree with this');
  });

  it('separates the same phrase corrected for a different reason', () => {
    assert.notEqual(
      buildWritingConceptKey('WRITING_PART_1', 'grammar', 'I agree'),
      buildWritingConceptKey('WRITING_PART_1', 'register', 'I agree'),
    );
  });

  it('stays bounded for a very long excerpt', () => {
    const key = buildWritingConceptKey('WRITING_PART_1', 'grammar', 'word '.repeat(200));

    assert.ok(key.length < 130, `key was ${key.length} chars`);
  });
});

describe('RecordWritingMistakesService', () => {
  it('records a correction as a mistake attributed to Writing', async () => {
    const { service, calls } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [correction()],
      gradedAt: GRADED_AT,
    });

    assert.deepEqual(result, { recordedCount: 1, skippedCount: 0 });
    const [concept] = calls.concepts;
    assert.equal(concept.source, MistakeSource.WRITING_SUBMISSION);
    assert.equal(concept.skillSlug, 'writing');
    assert.equal(concept.partCode, 'WRITING_PART_1');
    assert.equal(concept.correctAnswer, 'I agree with this');
    assert.equal(concept.userAnswer, 'I am agree with this');
    assert.equal(concept.baseWord, null, 'writing has no base word — the unit is a phrase');
  });

  it("maps the grader's category onto the error type", async () => {
    const { service, calls } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.EMAIL,
      corrections: [
        correction({ category: 'grammar' }),
        correction({ category: 'vocabulary', correctedExcerpt: 'a huge problem' }),
        correction({ category: 'spelling', correctedExcerpt: 'necessary' }),
        correction({ category: 'punctuation', correctedExcerpt: 'Hello, Ana' }),
        correction({ category: 'register', correctedExcerpt: 'I would like to' }),
      ],
      gradedAt: GRADED_AT,
    });

    assert.deepEqual(
      calls.wrongs.map((w) => w.errorType),
      [
        MistakeErrorType.GRAMMAR,
        MistakeErrorType.VOCABULARY,
        MistakeErrorType.SPELLING,
        MistakeErrorType.PUNCTUATION,
        MistakeErrorType.REGISTER,
      ],
    );
  });

  it('is honest that the classification came from a model, not a rule', async () => {
    const { service, calls } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [correction()],
      gradedAt: GRADED_AT,
    });

    assert.equal(calls.wrongs[0].classificationSource, MistakeClassificationSource.AI);
  });

  it('leaves an uncategorized correction unclassified rather than forcing a type', async () => {
    const { service, calls } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [correction({ category: 'other' })],
      gradedAt: GRADED_AT,
    });

    assert.equal(calls.wrongs[0].errorType, MistakeErrorType.UNKNOWN);
    assert.equal(calls.wrongs[0].classificationSource, MistakeClassificationSource.UNKNOWN);
  });

  it('never links a writing mistake to a practice attempt', async () => {
    const { service, calls } = makeService();

    await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [correction()],
      gradedAt: GRADED_AT,
    });

    const [occurrence] = calls.occurrences;
    assert.equal(occurrence.practiceAttemptId, null);
    assert.equal(occurrence.practiceExerciseId, null);
    assert.equal(occurrence.practiceItemId, null);
    assert.equal(occurrence.practiceAnswerId, null);
  });

  it('skips a correction that changed nothing', async () => {
    const { service, calls } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [
        correction({ originalExcerpt: 'I agree', correctedExcerpt: 'I agree' }),
        correction({ originalExcerpt: '  ', correctedExcerpt: 'something' }),
      ],
      gradedAt: GRADED_AT,
    });

    assert.deepEqual(result, { recordedCount: 0, skippedCount: 2 });
    assert.equal(calls.concepts.length, 0);
  });

  it('aggregates the same correction made in two different submissions', async () => {
    const { service, calls } = makeService();
    const input = {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [correction()],
      gradedAt: GRADED_AT,
    };

    await service.record(MANAGER, input);
    await service.record(MANAGER, { ...input, submissionId: 'submission-2' });

    assert.equal(calls.concepts[0].conceptKey, calls.concepts[1].conceptKey);
    assert.equal(calls.wrongs.length, 2, 'both occurrences count towards times_wrong');
  });

  it('does not double count when the same occurrence is replayed', async () => {
    const { service, calls } = makeService({ duplicateOccurrence: true });

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [correction()],
      gradedAt: GRADED_AT,
    });

    assert.equal(result.recordedCount, 0);
    assert.equal(calls.wrongs.length, 0);
  });

  it('records nothing for a submission the grader had no corrections for', async () => {
    const { service, calls } = makeService();

    const result = await service.record(MANAGER, {
      userId: USER_ID,
      submissionId: SUBMISSION_ID,
      taskType: WritingTaskType.ESSAY,
      corrections: [],
      gradedAt: GRADED_AT,
    });

    assert.deepEqual(result, { recordedCount: 0, skippedCount: 0 });
    assert.equal(calls.concepts.length, 0);
  });
});
