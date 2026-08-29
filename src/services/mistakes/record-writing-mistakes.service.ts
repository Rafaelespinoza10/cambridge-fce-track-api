import type { EntityManager } from 'typeorm';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import {
  MistakeClassificationSource,
  MistakeErrorType,
  MistakeSource,
  WritingTaskType,
} from '../../models/enums';
import type { WritingCorrection, WritingCorrectionCategory } from '../../models/writing-json-types';
import { normalizeTextAnswer } from '@lib/practice/practice-attempt-grading';
import { getWritingTaskFormat } from '@lib/writing/writing-task-catalog';

/**
 * Turns the corrections a graded Writing submission produced into Mistake
 * Bank entries.
 *
 * Writing enters the Mistake Bank through a different door from Practice,
 * and the difference is worth stating: Practice has a closed answer key, so
 * a mistake is "you got THIS item wrong". Writing is free text, so a mistake
 * is "the grader rewrote THIS phrase". There is no `isCorrect`, no item, and
 * no accepted-answers list — only an LLM's list of corrections, each already
 * carrying a category.
 *
 * Two consequences, both deliberate:
 *
 *  - The classification is free but it is NOT deterministic. Every concept
 *    recorded here is written with `classification_source: 'ai'`, because
 *    that is what it is. The existing rule that a human correction is never
 *    overwritten still applies.
 *  - Concepts are sparse. The same phrase rarely gets written twice, so most
 *    Writing concepts sit at `times_wrong: 1`. That is honest — "you made 12
 *    distinct grammar slips in writing" IS the signal — and the pattern
 *    rollup is where it becomes a weakness worth practising.
 */

const WRITING_EXAM_CODE = 'B2_FIRST';
const WRITING_PAPER_CODE = 'PAPER_2';
const WRITING_SKILL_SLUG = 'writing';

/**
 * `WritingTaskType` names the genre (essay, article, report…), not the exam
 * part, so the part comes from the existing writing task catalog rather than
 * a second mapping that could drift from it.
 */
export function partCodeForWritingTask(taskType: WritingTaskType): string {
  return `WRITING_PART_${getWritingTaskFormat(taskType).part}`;
}

/**
 * The Writing grader's own categories map almost one-to-one onto
 * MistakeErrorType — `punctuation` and `register` exist precisely because
 * Writing can produce them and Practice cannot. `other` deliberately becomes
 * UNKNOWN rather than being forced into a category it does not fit.
 */
const CATEGORY_TO_ERROR_TYPE: Record<WritingCorrectionCategory, MistakeErrorType> = {
  grammar: MistakeErrorType.GRAMMAR,
  vocabulary: MistakeErrorType.VOCABULARY,
  spelling: MistakeErrorType.SPELLING,
  punctuation: MistakeErrorType.PUNCTUATION,
  register: MistakeErrorType.REGISTER,
  other: MistakeErrorType.UNKNOWN,
};

/** Keeps a concept key bounded regardless of how long an excerpt is. */
const MAX_KEY_EXCERPT_LENGTH = 80;

export interface RecordWritingMistakesInput {
  userId: string;
  submissionId: string;
  taskType: WritingTaskType;
  corrections: WritingCorrection[];
  gradedAt: Date;
}

export interface MistakesRepositoryPort {
  ensureConcept(data: Parameters<MistakesRepository['ensureConcept']>[0]): Promise<string>;
  createOccurrence(
    data: Parameters<MistakesRepository['createOccurrence']>[0],
  ): Promise<string | null>;
  registerWrong(data: Parameters<MistakesRepository['registerWrong']>[0]): Promise<void>;
}

export interface RecordWritingMistakesServiceDeps {
  repository?: (manager: EntityManager) => MistakesRepositoryPort;
}

const DEFAULT_REPOSITORY_FACTORY = (manager: EntityManager): MistakesRepositoryPort =>
  new MistakesRepository(manager);

export interface RecordWritingMistakesResult {
  recordedCount: number;
  skippedCount: number;
}

/**
 * The identity of a Writing mistake: what the grader says it SHOULD have
 * said, plus the category. Keyed on the corrected form rather than the
 * original because that is the thing worth learning — two different wrong
 * ways of writing "I agree" are the same weakness.
 */
export function buildWritingConceptKey(
  partCode: string,
  category: WritingCorrectionCategory,
  correctedExcerpt: string,
): string {
  const corrected = normalizeTextAnswer(correctedExcerpt, false)
    .replace(/\|/g, '/')
    .slice(0, MAX_KEY_EXCERPT_LENGTH);
  return `${partCode.toLowerCase()}|${category}|${corrected}`;
}

export class RecordWritingMistakesService {
  constructor(private readonly deps: RecordWritingMistakesServiceDeps = {}) {}

  async record(
    manager: EntityManager,
    input: RecordWritingMistakesInput,
  ): Promise<RecordWritingMistakesResult> {
    const repository = (this.deps.repository ?? DEFAULT_REPOSITORY_FACTORY)(manager);
    const partCode = partCodeForWritingTask(input.taskType);
    const result: RecordWritingMistakesResult = { recordedCount: 0, skippedCount: 0 };

    for (const correction of input.corrections) {
      const corrected = correction.correctedExcerpt.trim();
      const original = correction.originalExcerpt.trim();
      // A correction with nothing to compare cannot identify a weakness, and
      // a "correction" that changed nothing is not one.
      if (corrected === '' || original === '' || corrected === original) {
        result.skippedCount += 1;
        continue;
      }

      const errorType = CATEGORY_TO_ERROR_TYPE[correction.category];
      const conceptKey = buildWritingConceptKey(partCode, correction.category, corrected);

      const conceptId = await repository.ensureConcept({
        userId: input.userId,
        conceptKey,
        source: MistakeSource.WRITING_SUBMISSION,
        skillSlug: WRITING_SKILL_SLUG,
        examCode: WRITING_EXAM_CODE,
        paperCode: WRITING_PAPER_CODE,
        partCode,
        taskType: input.taskType,
        // Writing has no base word: the unit is a phrase, not a lexeme.
        baseWord: null,
        prompt: original,
        correctAnswer: corrected,
        userAnswer: original,
        explanation: correction.explanation,
        targetLevel: null,
        occurredAt: input.gradedAt,
      });

      const occurrenceId = await repository.createOccurrence({
        userId: input.userId,
        conceptId,
        source: MistakeSource.WRITING_SUBMISSION,
        // The practice_* columns stay null: this mistake came from a written
        // text, not from a graded practice item. `source` is what says so.
        practiceAttemptId: null,
        practiceExerciseId: null,
        practiceItemId: null,
        practiceAnswerId: null,
        userAnswer: original,
        normalizedAnswer: normalizeTextAnswer(original, false),
        correctAnswer: corrected,
        isUnanswered: false,
        occurredAt: input.gradedAt,
      });
      if (occurrenceId === null) continue;

      await repository.registerWrong({
        conceptId,
        userId: input.userId,
        prompt: original,
        correctAnswer: corrected,
        userAnswer: original,
        explanation: correction.explanation,
        baseWord: null,
        taskType: input.taskType,
        targetLevel: null,
        occurredAt: input.gradedAt,
        errorType,
        errorSubtype: null,
        expectedWordClass: null,
        userWordClass: null,
        // Honest about provenance: the Writing grader is an LLM, so this is
        // an AI classification even though it arrived pre-categorized.
        classificationSource:
          errorType === MistakeErrorType.UNKNOWN
            ? MistakeClassificationSource.UNKNOWN
            : MistakeClassificationSource.AI,
      });
      result.recordedCount += 1;
    }

    return result;
  }
}
