/// <reference path="../../types/markdown.d.ts" />
import { MistakeClassificationSource, MistakeErrorType } from '../../models/enums';
import type { MistakeClassificationResult } from '@lib/mistakes/mistake-classifier';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import SYSTEM_PROMPT from '../../prompts/mistakes/classify-lexical-mistake.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/mistakes/classify-lexical-mistake.user.md';

/**
 * The one Use of English part with no honest deterministic signal.
 *
 * Multiple Choice Cloze (Part 1) asks the student to pick between four real
 * words. Telling a collocation failure ("make a decision") apart from a
 * phrasal verb ("put off") apart from a semantic nuance genuinely requires
 * knowing English — there is no suffix, key word or closed set to read it
 * off, which is why the deterministic classifier leaves this task type
 * UNKNOWN and this pass exists instead.
 *
 * Everything it produces is written with `classificationSource: 'ai'`, so a
 * later report can always separate "a rule decided this" from "a model
 * decided this", and the existing rule that a human classification is never
 * overwritten still holds.
 */

/** Same shape as every other classifier/grader port in this codebase. */
export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

export interface LexicalMistakeInput {
  prompt: string;
  /** Rendered "id) label" lines, or null for an item without options. */
  options: string | null;
  userAnswer: string;
  correctAnswer: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_TEMPERATURE = 0;
const RESPONSE_MAX_OUTPUT_TOKENS = 120;

/**
 * The only categories this pass may produce. Deliberately a subset of
 * MistakeErrorType: the model is never offered `word_class`, `spelling` or
 * `prefix_suffix`, which belong to task types that have deterministic
 * classifiers and must never be decided by a guess.
 */
const AI_CATEGORIES = ['collocation', 'phrasal_verb', 'vocabulary', 'grammar', 'unknown'] as const;
type AiCategory = (typeof AI_CATEGORIES)[number];

const CATEGORY_TO_ERROR_TYPE: Record<Exclude<AiCategory, 'unknown'>, MistakeErrorType> = {
  collocation: MistakeErrorType.COLLOCATION,
  phrasal_verb: MistakeErrorType.PHRASAL_VERB,
  vocabulary: MistakeErrorType.VOCABULARY,
  grammar: MistakeErrorType.GRAMMAR,
};

const UNCLASSIFIED: MistakeClassificationResult = {
  errorType: MistakeErrorType.UNKNOWN,
  errorSubtype: null,
  expectedWordClass: null,
  userWordClass: null,
  confidence: 0,
  classificationSource: MistakeClassificationSource.UNKNOWN,
};

function buildSchema(): LLMJsonSchema {
  return {
    name: 'lexical_mistake_classification',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['category', 'confident'],
      properties: {
        category: { type: 'string', enum: [...AI_CATEGORIES] },
        /**
         * A separate flag rather than a numeric score: models are poorly
         * calibrated at inventing probabilities, but reliably honest about a
         * yes/no "was this clear-cut?".
         */
        confident: { type: 'boolean' },
      },
    },
  };
}

function buildMessages(input: LexicalMistakeInput): LLMChatMessage[] {
  const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
    prompt: input.prompt,
    options: input.options ?? '(no options recorded)',
    userAnswer: input.userAnswer,
    correctAnswer: input.correctAnswer,
  });
  return [
    { role: 'system', content: SYSTEM_PROMPT.trim() },
    { role: 'user', content: userPrompt },
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Never throws on a bad classification — an unusable response degrades to
 * UNCLASSIFIED, exactly as if the model had said "unknown". A mistake that
 * stays unclassified is the safe outcome; one classified wrongly sends the
 * student to drill a weakness they never had.
 */
export function toClassification(value: unknown): MistakeClassificationResult {
  if (!isPlainObject(value)) return UNCLASSIFIED;

  const category = value.category;
  if (typeof category !== 'string') return UNCLASSIFIED;
  if (!(AI_CATEGORIES as readonly string[]).includes(category)) return UNCLASSIFIED;
  if (category === 'unknown') return UNCLASSIFIED;

  // An explicitly unconfident answer is treated as no answer: the prompt
  // asks the model to say so, and honouring that is the whole point of
  // asking.
  if (value.confident !== true) return UNCLASSIFIED;

  return {
    errorType: CATEGORY_TO_ERROR_TYPE[category as Exclude<AiCategory, 'unknown'>],
    // Part 1 has no subtype vocabulary: `collocation`/`phrasal_verb` are
    // already the finest useful grain here, and inventing one would be a
    // guess on top of a guess.
    errorSubtype: null,
    expectedWordClass: null,
    userWordClass: null,
    confidence: 0.7,
    classificationSource: MistakeClassificationSource.AI,
  };
}

export class LexicalMistakeClassifier {
  constructor(private readonly llm: LLMServicePort) {}

  /**
   * Classifies one mistake. Any provider failure — timeout, rate limit, bad
   * JSON — resolves to UNCLASSIFIED rather than rejecting: this runs after
   * an attempt has already been graded and recorded, and a classification
   * is an enhancement. It must never be able to fail a submission.
   */
  async classify(input: LexicalMistakeInput): Promise<MistakeClassificationResult> {
    try {
      const raw = await this.llm.completeStructured(buildMessages(input), {
        responseSchema: buildSchema(),
        timeoutMs: REQUEST_TIMEOUT_MS,
        temperature: RESPONSE_TEMPERATURE,
        maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
        reasoningEffort: 'low',
      });
      return toClassification(raw);
    } catch {
      return UNCLASSIFIED;
    }
  }
}
