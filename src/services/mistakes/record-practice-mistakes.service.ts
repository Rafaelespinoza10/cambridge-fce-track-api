import type { EntityManager } from 'typeorm';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { MistakeSource } from '../../models/enums';
import type { EnglishLevel } from '../../models/enums';
import type { PracticeItem } from '../../models/PracticeItem';
import type { PracticeAnswerPayload } from '../../models/practice-json-types';
import { formatAcceptedAnswers, formatUserAnswer } from '@lib/practice/practice-attempt-grading';
import {
  buildConceptKey,
  extractBaseWord,
  resolveSkillSlug,
} from '@lib/mistakes/mistake-concept-key';
import { MistakeClassifier, type MistakeClassificationResult } from '@lib/mistakes/mistake-classifier';

/** The exercise metadata a mistake needs — a structural subset of PracticeExercise. */
export interface RecordPracticeMistakesExercise {
  id: string;
  exam_code: string;
  paper_code: string;
  part_code: string;
  target_level: EnglishLevel | null;
}

export interface RecordPracticeMistakesGradedItem {
  item: PracticeItem;
  payload: PracticeAnswerPayload;
  normalizedAnswer: string | null;
  isCorrect: boolean;
  /** The persisted PracticeAnswer row id, when it is known (it is, at submit time). */
  answerId: string | null;
}

export interface RecordPracticeMistakesInput {
  userId: string;
  attemptId: string;
  exercise: RecordPracticeMistakesExercise;
  items: RecordPracticeMistakesGradedItem[];
  occurredAt: Date;
}

export interface RecordPracticeMistakesResult {
  /** Wrong answers that produced (or updated) a concept. */
  recordedCount: number;
  /** Correct answers that bumped `times_correct` on a previously failed concept. */
  masteredCount: number;
  /** Wrong answers skipped because the item carried no usable answer key. */
  skippedCount: number;
}

export interface MistakesRepositoryPort {
  ensureConcept(data: Parameters<MistakesRepository['ensureConcept']>[0]): Promise<string>;
  createOccurrence(
    data: Parameters<MistakesRepository['createOccurrence']>[0],
  ): Promise<string | null>;
  registerWrong(data: Parameters<MistakesRepository['registerWrong']>[0]): Promise<void>;
  registerLaterCorrect(userId: string, conceptKey: string, at: Date): Promise<boolean>;
}

export interface MistakeClassifierPort {
  classify(input: {
    baseWord: string | null;
    userAnswer: string;
    correctAnswer: string;
    taskType: string | null;
  }): MistakeClassificationResult;
}

export interface RecordPracticeMistakesServiceDeps {
  /** Injectable seam for tests — the default builds the real repository on the caller's manager. */
  repository?: (manager: EntityManager) => MistakesRepositoryPort;
  /** Injectable seam for tests — the default is the real deterministic MistakeClassifier. */
  classifier?: MistakeClassifierPort;
}

const DEFAULT_REPOSITORY_FACTORY = (manager: EntityManager): MistakesRepositoryPort =>
  new MistakesRepository(manager);

const DEFAULT_CLASSIFIER: MistakeClassifierPort = new MistakeClassifier();

/**
 * Turns an already-graded practice submission into Mistake Bank rows.
 *
 * Runs inside the submitting transaction (see SubmitPracticeAttemptService),
 * exactly like the Plan/Home linking that already lives there — a mistake is
 * never recorded for an attempt that failed to complete, and a completed
 * attempt never silently loses its mistakes.
 *
 * What it does NOT do, on purpose: it never grades (it only reads the
 * `isCorrect` the deterministic grader produced), never calls an AI (the
 * classifier it runs is fully deterministic — see MistakeClassifier's own
 * doc comment for why), and never creates anything at all for a correct
 * answer — a correct answer can only bump `times_correct` on a concept the
 * user had already failed before.
 */
export class RecordPracticeMistakesService {
  constructor(private readonly deps: RecordPracticeMistakesServiceDeps = {}) {}

  async record(
    manager: EntityManager,
    input: RecordPracticeMistakesInput,
  ): Promise<RecordPracticeMistakesResult> {
    const repository = (this.deps.repository ?? DEFAULT_REPOSITORY_FACTORY)(manager);
    const result: RecordPracticeMistakesResult = {
      recordedCount: 0,
      masteredCount: 0,
      skippedCount: 0,
    };

    for (const graded of input.items) {
      const acceptedAnswers = formatAcceptedAnswers(graded.item);
      const primaryCorrectAnswer = acceptedAnswers[0];
      if (primaryCorrectAnswer === undefined || primaryCorrectAnswer.trim() === '') {
        // An item with no usable accepted answer can't identify a concept.
        // Skipping is the honest outcome: a mistake row keyed on an empty
        // correct answer would be noise nothing can ever act on. Correct
        // answers are unaffected — they'd be a no-op anyway.
        if (!graded.isCorrect) result.skippedCount += 1;
        continue;
      }

      const baseWord = extractBaseWord(graded.item.task_type, graded.item.prompt);
      const conceptKey = buildConceptKey({
        partCode: input.exercise.part_code,
        taskType: graded.item.task_type,
        itemId: graded.item.id,
        baseWord,
        primaryCorrectAnswer,
      });

      if (graded.isCorrect) {
        const bumped = await repository.registerLaterCorrect(
          input.userId,
          conceptKey,
          input.occurredAt,
        );
        if (bumped) result.masteredCount += 1;
        continue;
      }

      const correctAnswer = acceptedAnswers.join(' / ');
      const userAnswer = formatUserAnswer(graded.item, graded.payload);

      // Classified against the single primary accepted answer, never the
      // "/"-joined display string above — that string can legitimately
      // contain more than one valid form, which the classifier's suffix
      // heuristics were never meant to parse.
      const classification = (this.deps.classifier ?? DEFAULT_CLASSIFIER).classify({
        baseWord,
        userAnswer,
        correctAnswer: primaryCorrectAnswer,
        taskType: graded.item.task_type,
      });

      const conceptId = await repository.ensureConcept({
        userId: input.userId,
        conceptKey,
        source: MistakeSource.PRACTICE_ATTEMPT,
        skillSlug: resolveSkillSlug(input.exercise.part_code),
        examCode: input.exercise.exam_code,
        paperCode: input.exercise.paper_code,
        partCode: input.exercise.part_code,
        taskType: graded.item.task_type,
        baseWord,
        prompt: graded.item.prompt,
        correctAnswer,
        userAnswer,
        explanation: graded.item.explanation,
        targetLevel: input.exercise.target_level,
        occurredAt: input.occurredAt,
      });

      const occurrenceId = await repository.createOccurrence({
        userId: input.userId,
        conceptId,
        source: MistakeSource.PRACTICE_ATTEMPT,
        practiceAttemptId: input.attemptId,
        practiceExerciseId: input.exercise.id,
        practiceItemId: graded.item.id,
        practiceAnswerId: graded.answerId,
        userAnswer,
        normalizedAnswer: graded.normalizedAnswer,
        correctAnswer,
        isUnanswered: graded.payload.kind === 'unanswered',
        occurredAt: input.occurredAt,
      });

      // No occurrence -> this exact graded answer was already recorded
      // before (idempotent replay). Bumping the counter anyway would make
      // "times failed" a lie.
      if (occurrenceId === null) continue;

      await repository.registerWrong({
        conceptId,
        userId: input.userId,
        prompt: graded.item.prompt,
        correctAnswer,
        userAnswer,
        explanation: graded.item.explanation,
        baseWord,
        taskType: graded.item.task_type,
        targetLevel: input.exercise.target_level,
        occurredAt: input.occurredAt,
        errorType: classification.errorType,
        errorSubtype: classification.errorSubtype,
        expectedWordClass: classification.expectedWordClass,
        userWordClass: classification.userWordClass,
        classificationSource: classification.classificationSource,
      });
      result.recordedCount += 1;
    }

    return result;
  }
}
