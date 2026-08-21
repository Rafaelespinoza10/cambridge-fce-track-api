import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { PracticeAttemptsRepository } from '@repositories/practice/practice-attempts.repository';
import { PracticeAnswersRepository } from '@repositories/practice/practice-answers.repository';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import { FlashcardDraftGenerator } from '../flashcards/flashcard-draft-generator';
import type { LLMServicePort } from '../flashcards/flashcard-draft-generator';
import { StartPracticeAttemptService } from './start-practice-attempt.service';
import { GetActivePracticeAttemptService } from './get-active-practice-attempt.service';
import { GetPracticeAttemptService } from './get-practice-attempt.service';
import { SubmitPracticeAttemptService } from './submit-practice-attempt.service';
import { AbandonPracticeAttemptService } from './abandon-practice-attempt.service';
import { ListPracticeAttemptHistoryService } from './list-practice-attempt-history.service';
import { GeneratePracticeErrorFlashcardDraftService } from './generate-practice-error-flashcard-draft.service';

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

let _openaiClient: OpenAI | null = null;

/** Reuses the OpenAI client across Lambda warm invocations. */
function getOpenAIClient(): OpenAI {
  if (_openaiClient !== null) {
    return _openaiClient;
  }

  const apiKey = process.env['OPEN_AI_API_KEY'];
  if (!apiKey) {
    throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
  }

  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

let _llmService: LLMService | null = null;

/**
 * Builds the real LLMService only the first time `completeStructured` is
 * actually called, not when this composition module wires up its
 * dependencies. Every other attempt endpoint (start/get/submit/abandon/
 * list) must keep working with no `OPEN_AI_API_KEY` configured at all —
 * eagerly calling `getOpenAIClient()` here would make ALL of them fail
 * just because the OpenAI key is missing or invalid, even though only the
 * flashcard-draft endpoint ever needs it.
 */
function getLazyLLMService(): LLMServicePort {
  return {
    completeStructured(
      messages: LLMChatMessage[],
      options: LLMStructuredCompletionOptions,
    ): Promise<unknown> {
      if (_llmService === null) {
        const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
        _llmService = new LLMService({
          provider,
          defaultModel: provider.defaultModel,
          defaultTemperature: DEFAULT_TEMPERATURE,
          defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        });
      }
      return _llmService.completeStructured(messages, options);
    },
  };
}

interface PracticeAttemptServices {
  startAttempt: StartPracticeAttemptService;
  getActiveAttempt: GetActivePracticeAttemptService;
  getAttempt: GetPracticeAttemptService;
  submitAttempt: SubmitPracticeAttemptService;
  abandonAttempt: AbandonPracticeAttemptService;
  listAttemptHistory: ListPracticeAttemptHistoryService;
  generateErrorFlashcardDraft: GeneratePracticeErrorFlashcardDraftService;
}

async function buildPracticeAttemptServices(): Promise<PracticeAttemptServices> {
  const dataSource = await getDatabaseConnection();

  return {
    startAttempt: new StartPracticeAttemptService(dataSource),
    getActiveAttempt: new GetActivePracticeAttemptService({
      repository: new PracticeAttemptsRepository(dataSource),
      exercisesRepository: new PracticeExercisesRepository(dataSource),
    }),
    getAttempt: new GetPracticeAttemptService({
      attempts: new PracticeAttemptsRepository(dataSource),
      exercises: new PracticeExercisesRepository(dataSource),
      answers: new PracticeAnswersRepository(dataSource),
    }),
    submitAttempt: new SubmitPracticeAttemptService(dataSource),
    abandonAttempt: new AbandonPracticeAttemptService({
      repository: new PracticeAttemptsRepository(dataSource),
    }),
    listAttemptHistory: new ListPracticeAttemptHistoryService({
      repository: new PracticeAttemptsRepository(dataSource),
    }),
    generateErrorFlashcardDraft: new GeneratePracticeErrorFlashcardDraftService({
      attempts: new PracticeAttemptsRepository(dataSource),
      exercises: new PracticeExercisesRepository(dataSource),
      answers: new PracticeAnswersRepository(dataSource),
      generator: new FlashcardDraftGenerator({ llm: getLazyLLMService() }),
    }),
  };
}

export { buildPracticeAttemptServices };
export type { PracticeAttemptServices };
