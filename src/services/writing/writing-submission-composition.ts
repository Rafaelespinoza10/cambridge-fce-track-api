import OpenAI from 'openai';

import { getDatabaseConnection } from '../../lib/database';
import { WritingTasksRepository } from '../../repositories/writing-tasks.repository';
import { WritingSubmissionsRepository } from '../../repositories/writing-submissions.repository';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import { FlashcardDraftGenerator } from '../flashcards/flashcard-draft-generator';
import type { LLMServicePort as FlashcardLLMServicePort } from '../flashcards/flashcard-draft-generator';
import { StartWritingSubmissionService } from './start-writing-submission.service';
import { GetActiveWritingSubmissionService } from './get-active-writing-submission.service';
import { GetWritingSubmissionService } from './get-writing-submission.service';
import { SubmitWritingSubmissionService } from './submit-writing-submission.service';
import { AbandonWritingSubmissionService } from './abandon-writing-submission.service';
import { GenerateWritingCorrectionFlashcardDraftService } from './generate-writing-correction-flashcard-draft.service';
import { ListWritingSubmissionHistoryService } from './list-writing-submission-history.service';

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
 * dependencies — start/get/get-active/abandon must keep working with no
 * `OPEN_AI_API_KEY` configured at all. Same pattern as
 * practice-attempt-composition.ts's getLazyLLMService, generalized to a
 * shared interface both SubmitWritingSubmissionService and
 * FlashcardDraftGenerator can use.
 */
function getLazyLLMService(): FlashcardLLMServicePort {
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

interface WritingSubmissionServices {
  startSubmission: StartWritingSubmissionService;
  getActiveSubmission: GetActiveWritingSubmissionService;
  getSubmission: GetWritingSubmissionService;
  submitSubmission: SubmitWritingSubmissionService;
  abandonSubmission: AbandonWritingSubmissionService;
  generateCorrectionFlashcardDraft: GenerateWritingCorrectionFlashcardDraftService;
  listSubmissionHistory: ListWritingSubmissionHistoryService;
}

async function buildWritingSubmissionServices(): Promise<WritingSubmissionServices> {
  const dataSource = await getDatabaseConnection();

  return {
    startSubmission: new StartWritingSubmissionService(dataSource),
    getActiveSubmission: new GetActiveWritingSubmissionService({
      repository: new WritingSubmissionsRepository(dataSource),
      tasksRepository: new WritingTasksRepository(dataSource),
    }),
    getSubmission: new GetWritingSubmissionService({
      submissions: new WritingSubmissionsRepository(dataSource),
      tasks: new WritingTasksRepository(dataSource),
    }),
    submitSubmission: new SubmitWritingSubmissionService(dataSource, {
      llm: getLazyLLMService(),
    }),
    abandonSubmission: new AbandonWritingSubmissionService({
      repository: new WritingSubmissionsRepository(dataSource),
    }),
    generateCorrectionFlashcardDraft: new GenerateWritingCorrectionFlashcardDraftService({
      submissions: new WritingSubmissionsRepository(dataSource),
      tasks: new WritingTasksRepository(dataSource),
      generator: new FlashcardDraftGenerator({ llm: getLazyLLMService() }),
    }),
    listSubmissionHistory: new ListWritingSubmissionHistoryService({
      repository: new WritingSubmissionsRepository(dataSource),
    }),
  };
}

export { buildWritingSubmissionServices };
export type { WritingSubmissionServices };
