import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  GeneratePracticeErrorFlashcardDraftService,
  GeneratePracticeErrorFlashcardDraftError,
  GeneratePracticeErrorFlashcardDraftErrorCode,
} from './generate-practice-error-flashcard-draft.service';
import type {
  PracticeAttemptsRepositoryPort,
  PracticeExercisesRepositoryPort,
  PracticeAnswersRepositoryPort,
  GeneratePracticeErrorFlashcardDraftServiceDeps,
} from './generate-practice-error-flashcard-draft.service';
import {
  FlashcardDraftGenerationError,
  FlashcardDraftGenerationErrorCode,
} from '../flashcards/flashcard-draft-generator';
import type {
  FlashcardDraftGeneratorPort,
  PracticeErrorDraftContext,
} from '../flashcards/flashcard-draft-generator';
import type { PracticeAttempt } from '../../models/PracticeAttempt';
import type { PracticeExercise } from '../../models/PracticeExercise';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswer } from '../../models/PracticeAnswer';
import type { GeneratedFlashcardDraftDto } from '../../interfaces/flashcards/generate-flashcard-draft.interface';
import { PracticeAttemptStatus, EnglishLevel, FlashcardType } from '../../models/enums';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const EXERCISE_ID = 'exercise-1';
const ITEM_ID = 'item-1';

const COMPLETED_ATTEMPT = {
  id: ATTEMPT_ID,
  user_id: USER_ID,
  exercise_id: EXERCISE_ID,
  status: PracticeAttemptStatus.COMPLETED,
} as unknown as PracticeAttempt;

const EXERCISE = {
  id: EXERCISE_ID,
  exam_code: 'B2_FIRST',
  paper_code: 'PAPER_1',
  part_code: 'UOE_PART_1',
  target_level: EnglishLevel.B1,
  stimulus: null,
} as unknown as PracticeExercise;

const SINGLE_CHOICE_ITEM = {
  id: ITEM_ID,
  exercise_id: EXERCISE_ID,
  task_type: 'multiple_choice_cloze',
  prompt: 'Your success depends ___ hard work.',
  options: [
    { id: 'a', label: 'of' },
    { id: 'b', label: 'on' },
  ],
  answer_key: { kind: 'single_choice', acceptedOptionIds: ['b'] },
  explanation: '"Depend" is always followed by "on".',
  skill_tags: ['prepositions'],
} as unknown as PracticeItem;

const TEXT_ITEM = {
  id: ITEM_ID,
  exercise_id: EXERCISE_ID,
  task_type: 'open_cloze',
  prompt: 'Fill in the gap: I have never ___ such a beautiful place.',
  options: null,
  answer_key: { kind: 'text', acceptedAnswers: ['seen'], caseSensitive: false },
  explanation: 'Present perfect uses the past participle.',
  skill_tags: ['present-perfect'],
} as unknown as PracticeItem;

const INCORRECT_SINGLE_CHOICE_ANSWER = {
  item_id: ITEM_ID,
  answer_payload: { kind: 'single_choice', optionId: 'a' },
  is_correct: false,
} as unknown as PracticeAnswer;

const INCORRECT_TEXT_ANSWER = {
  item_id: ITEM_ID,
  answer_payload: { kind: 'text', value: 'saw' },
  is_correct: false,
} as unknown as PracticeAnswer;

const UNANSWERED_ANSWER = {
  item_id: ITEM_ID,
  answer_payload: { kind: 'unanswered' },
  is_correct: false,
} as unknown as PracticeAnswer;

const CORRECT_ANSWER = {
  item_id: ITEM_ID,
  answer_payload: { kind: 'single_choice', optionId: 'b' },
  is_correct: true,
} as unknown as PracticeAnswer;

const VALID_DRAFT: GeneratedFlashcardDraftDto = {
  type: FlashcardType.GRAMMAR,
  front: 'Which preposition follows "depend"?',
  back: 'depend on',
  translation: 'depender de',
  example: 'Your progress depends on consistent practice.',
  personalExample: 'My Cambridge progress depends on studying every day.',
  notes: 'Use "depend on", not "depend of".',
  sourceName: null,
  sourceUrl: null,
  level: EnglishLevel.B1,
  tags: ['prepositions', 'grammar'],
};

interface Overrides {
  findByIdForUser?: PracticeAttemptsRepositoryPort['findByIdForUser'];
  findExerciseWithAnswerKeysForEvaluation?: PracticeExercisesRepositoryPort['findExerciseWithAnswerKeysForEvaluation'];
  findByAttemptAndItemForUser?: PracticeAnswersRepositoryPort['findByAttemptAndItemForUser'];
  generateFromPracticeError?: FlashcardDraftGeneratorPort['generateFromPracticeError'];
  item?: PracticeItem;
}

function makeService(overrides: Overrides = {}): {
  service: GeneratePracticeErrorFlashcardDraftService;
  capturedContext: { value: PracticeErrorDraftContext | null };
} {
  const item = overrides.item ?? SINGLE_CHOICE_ITEM;
  const capturedContext: { value: PracticeErrorDraftContext | null } = { value: null };

  const attempts: PracticeAttemptsRepositoryPort = {
    findByIdForUser: overrides.findByIdForUser ?? (async () => COMPLETED_ATTEMPT),
  };
  const exercises: PracticeExercisesRepositoryPort = {
    findExerciseWithAnswerKeysForEvaluation:
      overrides.findExerciseWithAnswerKeysForEvaluation ??
      (async () => ({ exercise: EXERCISE, items: [item] })),
  };
  const answers: PracticeAnswersRepositoryPort = {
    findByAttemptAndItemForUser:
      overrides.findByAttemptAndItemForUser ?? (async () => INCORRECT_SINGLE_CHOICE_ANSWER),
  };
  const generator: FlashcardDraftGeneratorPort = {
    generateFromTerm: async () => VALID_DRAFT,
    generateFromPracticeError:
      overrides.generateFromPracticeError ??
      (async (context) => {
        capturedContext.value = context;
        return VALID_DRAFT;
      }),
    generateFromWritingCorrection: async () => VALID_DRAFT,
  };

  const deps: GeneratePracticeErrorFlashcardDraftServiceDeps = {
    attempts,
    exercises,
    answers,
    generator,
  };
  return { service: new GeneratePracticeErrorFlashcardDraftService(deps), capturedContext };
}

function assertErr(err: unknown, code: GeneratePracticeErrorFlashcardDraftErrorCode): true {
  assert.ok(err instanceof GeneratePracticeErrorFlashcardDraftError);
  assert.equal(err.code, code);
  return true;
}

// ── happy paths ──────────────────────────────────────────────────────────────────

describe('GeneratePracticeErrorFlashcardDraftService.execute — happy paths', () => {
  it('generates a draft from an incorrect single_choice answer', async () => {
    const { service } = makeService();
    const result = await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    assert.deepEqual(result, { draft: VALID_DRAFT });
  });

  it('generates a draft from an incorrect text answer', async () => {
    const { service } = makeService({
      item: TEXT_ITEM,
      findByAttemptAndItemForUser: async () => INCORRECT_TEXT_ANSWER,
    });
    const result = await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    assert.deepEqual(result, { draft: VALID_DRAFT });
  });

  it('generates a draft from an unanswered item', async () => {
    const { service } = makeService({ findByAttemptAndItemForUser: async () => UNANSWERED_ANSWER });
    const result = await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    assert.deepEqual(result, { draft: VALID_DRAFT });
  });
});

// ── ownership / state validation ────────────────────────────────────────────────

describe('GeneratePracticeErrorFlashcardDraftService.execute — ownership and state', () => {
  it('throws ATTEMPT_NOT_FOUND for a missing/foreign/deleted attempt', async () => {
    const { service } = makeService({ findByIdForUser: async () => null });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_FOUND),
    );
  });

  it('throws ATTEMPT_NOT_COMPLETED for an in_progress attempt', async () => {
    const { service } = makeService({
      findByIdForUser: async () =>
        ({
          ...COMPLETED_ATTEMPT,
          status: PracticeAttemptStatus.IN_PROGRESS,
        }) as unknown as PracticeAttempt,
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_COMPLETED),
    );
  });

  it('throws ATTEMPT_NOT_COMPLETED for an abandoned attempt', async () => {
    const { service } = makeService({
      findByIdForUser: async () =>
        ({
          ...COMPLETED_ATTEMPT,
          status: PracticeAttemptStatus.ABANDONED,
        }) as unknown as PracticeAttempt,
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.ATTEMPT_NOT_COMPLETED),
    );
  });

  it('throws PRACTICE_ITEM_NOT_FOUND when the item does not belong to the exercise', async () => {
    const { service } = makeService({
      findExerciseWithAnswerKeysForEvaluation: async () => ({ exercise: EXERCISE, items: [] }),
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_FOUND),
    );
  });

  // PR 3 guarantees exactly one persisted PracticeAnswer per item on a
  // completed attempt — by the time we get here the attempt is completed
  // and the item belongs to its exercise, so a missing answer is internal
  // data corruption, never a legitimate "not found". It must be masked as
  // a 500 (PERSISTENCE_INCONSISTENCY), never a 404, and must never reach
  // the generator or write anything.
  it('throws PERSISTENCE_INCONSISTENCY (not a 404) when no answer exists for a completed attempt/item', async () => {
    let generatorCalled = false;
    const { service } = makeService({
      findByAttemptAndItemForUser: async () => null,
      generateFromPracticeError: async () => {
        generatorCalled = true;
        return VALID_DRAFT;
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY),
    );
    assert.equal(generatorCalled, false, 'the generator must never be called');
  });

  it('throws PRACTICE_ITEM_NOT_INCORRECT when the answer was correct', async () => {
    const { service } = makeService({ findByAttemptAndItemForUser: async () => CORRECT_ANSWER });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.PRACTICE_ITEM_NOT_INCORRECT),
    );
  });

  it('throws PERSISTENCE_INCONSISTENCY when the exercise cannot be re-read', async () => {
    const { service } = makeService({
      findExerciseWithAnswerKeysForEvaluation: async () => null,
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY),
    );
  });

  it('scopes every lookup to the given userId', async () => {
    let capturedAttemptUserId: string | undefined;
    let capturedExerciseUserId: string | undefined;
    let capturedAnswerUserId: string | undefined;
    const { service } = makeService({
      findByIdForUser: async (_attemptId, userId) => {
        capturedAttemptUserId = userId;
        return COMPLETED_ATTEMPT;
      },
      findExerciseWithAnswerKeysForEvaluation: async (_exerciseId, userId) => {
        capturedExerciseUserId = userId;
        return { exercise: EXERCISE, items: [SINGLE_CHOICE_ITEM] };
      },
      findByAttemptAndItemForUser: async (_attemptId, _itemId, userId) => {
        capturedAnswerUserId = userId;
        return INCORRECT_SINGLE_CHOICE_ANSWER;
      },
    });
    await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    assert.equal(capturedAttemptUserId, USER_ID);
    assert.equal(capturedExerciseUserId, USER_ID);
    assert.equal(capturedAnswerUserId, USER_ID);
  });
});

// ── input validation ────────────────────────────────────────────────────────────

describe('GeneratePracticeErrorFlashcardDraftService.execute — input validation', () => {
  it('rejects an empty userId', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute('', ATTEMPT_ID, ITEM_ID),
      (err: unknown) => assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an empty attemptId', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(USER_ID, '', ITEM_ID),
      (err: unknown) => assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.INVALID_INPUT),
    );
  });

  it('rejects an empty itemId', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ''),
      (err: unknown) => assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.INVALID_INPUT),
    );
  });
});

// ── context safety ───────────────────────────────────────────────────────────────

describe('GeneratePracticeErrorFlashcardDraftService.execute — context safety', () => {
  it('builds context exclusively from persisted data (exam/paper/part/taskType/prompt/answers/explanation/skillTags/level)', async () => {
    const { service, capturedContext } = makeService();
    await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    const context = capturedContext.value;
    assert.ok(context);
    assert.equal(context.examCode, 'B2_FIRST');
    assert.equal(context.paperCode, 'PAPER_1');
    assert.equal(context.partCode, 'UOE_PART_1');
    assert.equal(context.taskType, 'multiple_choice_cloze');
    assert.equal(context.prompt, 'Your success depends ___ hard work.');
    assert.equal(context.userAnswer, 'of');
    assert.equal(context.correctAnswer, 'on');
    assert.equal(context.explanation, '"Depend" is always followed by "on".');
    assert.deepEqual(context.skillTags, ['prepositions']);
    assert.equal(context.targetLevel, EnglishLevel.B1);
  });

  it('never includes userId, attemptId, itemId, or answerKey shape in the context object', async () => {
    const { service, capturedContext } = makeService();
    await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    const serialized = JSON.stringify(capturedContext.value);
    assert.doesNotMatch(serialized, /userId|attemptId|itemId|answerKey|acceptedOptionIds/i);
    assert.doesNotMatch(serialized, new RegExp(USER_ID));
    assert.doesNotMatch(serialized, new RegExp(ATTEMPT_ID));
  });

  it('renders unanswered as an explicit placeholder, never an empty string', async () => {
    const { service, capturedContext } = makeService({
      findByAttemptAndItemForUser: async () => UNANSWERED_ANSWER,
    });
    await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    assert.equal(capturedContext.value?.userAnswer, '(no answer given)');
  });
});

// ── AI provider failures ────────────────────────────────────────────────────────

describe('GeneratePracticeErrorFlashcardDraftService.execute — AI provider failures', () => {
  it('maps AI_INVALID_RESPONSE through unchanged', async () => {
    const { service } = makeService({
      generateFromPracticeError: async () => {
        throw new FlashcardDraftGenerationError(
          'bad',
          FlashcardDraftGenerationErrorCode.AI_INVALID_RESPONSE,
        );
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.AI_INVALID_RESPONSE),
    );
  });

  it('maps AI_RATE_LIMITED through unchanged', async () => {
    const { service } = makeService({
      generateFromPracticeError: async () => {
        throw new FlashcardDraftGenerationError(
          'rate limited',
          FlashcardDraftGenerationErrorCode.AI_RATE_LIMITED,
        );
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.AI_RATE_LIMITED),
    );
  });

  it('maps AI_REQUEST_TIMEOUT through unchanged', async () => {
    const { service } = makeService({
      generateFromPracticeError: async () => {
        throw new FlashcardDraftGenerationError(
          'timeout',
          FlashcardDraftGenerationErrorCode.AI_REQUEST_TIMEOUT,
        );
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT),
    );
  });

  it('maps AI_PROVIDER_UNAVAILABLE through unchanged', async () => {
    const { service } = makeService({
      generateFromPracticeError: async () => {
        throw new FlashcardDraftGenerationError(
          'down',
          FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE),
    );
  });

  it('maps AI_CONFIGURATION_ERROR through unchanged', async () => {
    const { service } = makeService({
      generateFromPracticeError: async () => {
        throw new FlashcardDraftGenerationError(
          'not configured',
          FlashcardDraftGenerationErrorCode.AI_CONFIGURATION_ERROR,
        );
      },
    });
    await assert.rejects(
      () => service.execute(USER_ID, ATTEMPT_ID, ITEM_ID),
      (err: unknown) =>
        assertErr(err, GeneratePracticeErrorFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR),
    );
  });

  // The generator itself (flashcard-draft-generator.test.ts) already proves
  // raw provider error text never survives into a FlashcardDraftGenerationError
  // — this only confirms the service re-wraps that already-sanitized error
  // into its own domain error type/message unchanged, not raw text handling.
  it('re-wraps the generator error into its own domain error type, message intact', async () => {
    const { service } = makeService({
      generateFromPracticeError: async () => {
        throw new FlashcardDraftGenerationError(
          'The AI provider is currently unavailable',
          FlashcardDraftGenerationErrorCode.AI_PROVIDER_UNAVAILABLE,
        );
      },
    });
    try {
      await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
      assert.fail('expected execute() to reject');
    } catch (err) {
      assert.ok(err instanceof GeneratePracticeErrorFlashcardDraftError);
      assert.equal(err.message, 'The AI provider is currently unavailable');
    }
  });
});

// ── no side effects ──────────────────────────────────────────────────────────────

describe('GeneratePracticeErrorFlashcardDraftService.execute — no side effects', () => {
  it('the dependency ports expose no write/create/update methods (no flashcard, deck, attempt, or answer mutation is possible)', () => {
    const { service } = makeService();
    // TypeScript's own port interfaces already forbid this at compile time —
    // this asserts it at runtime too, on the actual injected dependency
    // object, so a future edit that widens the ports would fail loudly here.
    const deps = (service as unknown as { deps: GeneratePracticeErrorFlashcardDraftServiceDeps })
      .deps;
    assert.deepEqual(Object.keys(deps.attempts), ['findByIdForUser']);
    assert.deepEqual(Object.keys(deps.exercises), ['findExerciseWithAnswerKeysForEvaluation']);
    assert.deepEqual(Object.keys(deps.answers), ['findByAttemptAndItemForUser']);
  });

  it('returns only { draft } — no id/deckId/status/scheduling/attemptId/itemId', async () => {
    const { service } = makeService();
    const result = await service.execute(USER_ID, ATTEMPT_ID, ITEM_ID);
    assert.deepEqual(Object.keys(result), ['draft']);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /"id"|"deckId"|"status"|"scheduling"|"attemptId"|"itemId"|"userId"/,
    );
  });
});
