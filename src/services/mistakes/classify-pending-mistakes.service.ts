import { MistakeClassificationSource, MistakeErrorType } from '../../models/enums';
import type { MistakeConcept } from '../../models/MistakeConcept';
import type { MistakeClassificationResult } from '@lib/mistakes/mistake-classifier';
import type { LexicalMistakeInput } from './classify-lexical-mistake';

export enum ClassifyPendingMistakesErrorCode {
  INVALID_INPUT = 'invalid_input',
}

export class ClassifyPendingMistakesError extends Error {
  constructor(
    message: string,
    readonly code: ClassifyPendingMistakesErrorCode,
  ) {
    super(message);
    this.name = 'ClassifyPendingMistakesError';
  }
}

/**
 * The only task type this pass handles. Everything else either has a
 * deterministic classifier already (Word Formation, Key Word Transformation,
 * Open Cloze) or has no reusable concept to classify at all (Reading).
 */
export const AI_CLASSIFIABLE_TASK_TYPE = 'multiple_choice_cloze';

/** Hard cap per run: this is billable work, and a user's backlog is finite. */
const MAX_PER_RUN = 10;

export interface MistakesRepositoryPort {
  findUnclassifiedForUser(
    userId: string,
    taskType: string,
    limit: number,
  ): Promise<MistakeConcept[]>;
  reclassify(data: {
    userId: string;
    conceptId: string;
    errorType: MistakeErrorType;
    errorSubtype: MistakeErrorSubtype | null;
    classificationSource: MistakeClassificationSource;
  }): Promise<boolean>;
}

type MistakeErrorSubtype = MistakeClassificationResult['errorSubtype'];

export interface LexicalClassifierPort {
  classify(input: LexicalMistakeInput): Promise<MistakeClassificationResult>;
}

export interface ClassifyPendingMistakesServiceDeps {
  repository: MistakesRepositoryPort;
  classifier: LexicalClassifierPort;
}

export interface ClassifyPendingMistakesResult {
  /** How many concepts were looked at. */
  examined: number;
  /** How many the model was actually confident enough to classify. */
  classified: number;
}

/**
 * Second-pass classification for the one Use of English part no rule can
 * read: Multiple Choice Cloze.
 *
 * Runs on its own request, never inside the submit transaction — an LLM call
 * has no business holding a database transaction open, and a submission must
 * never fail because a classification did. Everything it touches was already
 * graded and recorded; this only enriches it.
 *
 * Safe to call repeatedly: the repository only writes onto concepts still
 * marked `unknown`, so a re-run picks up what is genuinely new rather than
 * re-deciding what was already decided.
 */
export class ClassifyPendingMistakesService {
  constructor(private readonly deps: ClassifyPendingMistakesServiceDeps) {}

  async execute(userId: string): Promise<ClassifyPendingMistakesResult> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new ClassifyPendingMistakesError(
        'userId is required',
        ClassifyPendingMistakesErrorCode.INVALID_INPUT,
      );
    }

    const pending = await this.deps.repository.findUnclassifiedForUser(
      userId,
      AI_CLASSIFIABLE_TASK_TYPE,
      MAX_PER_RUN,
    );

    let classified = 0;
    for (const concept of pending) {
      const result = await this.deps.classifier.classify({
        prompt: concept.prompt,
        // MistakeConcept snapshots the prompt and both answers, but not the
        // option list — the answers are already resolved to their labels
        // (see formatUserAnswer), which is the distinction the model needs.
        options: null,
        userAnswer: concept.last_user_answer,
        correctAnswer: concept.correct_answer,
      });

      // The classifier degrades an unusable or unconfident response to
      // UNKNOWN rather than throwing; writing that back would be a no-op with
      // a wasted round trip, so skip it.
      if (result.errorType === MistakeErrorType.UNKNOWN) continue;

      const written = await this.deps.repository.reclassify({
        userId,
        conceptId: concept.id,
        errorType: result.errorType,
        errorSubtype: result.errorSubtype,
        classificationSource: result.classificationSource,
      });
      if (written) classified += 1;
    }

    return { examined: pending.length, classified };
  }
}
