import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import type { LLMChatMessage, LLMStructuredCompletionOptions } from '../llm/llm.types';
import { StartDailySessionSubmissionService } from './start-daily-session-submission.service';
import { SubmitDailySessionSubmissionService } from './submit-daily-session-submission.service';
import type { LLMServicePort } from './submit-daily-session-submission.service';

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
 * dependencies — start (and a future get/abandon) must keep working with no
 * `OPEN_AI_API_KEY` configured at all. Same pattern as
 * writing-submission-composition.ts's getLazyLLMService.
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

interface DailySessionSubmissionServices {
  startSubmission: StartDailySessionSubmissionService;
  submitSubmission: SubmitDailySessionSubmissionService;
}

async function buildDailySessionSubmissionServices(): Promise<DailySessionSubmissionServices> {
  const dataSource = await getDatabaseConnection();

  return {
    startSubmission: new StartDailySessionSubmissionService(dataSource),
    submitSubmission: new SubmitDailySessionSubmissionService(dataSource, {
      llm: getLazyLLMService(),
    }),
  };
}

export { buildDailySessionSubmissionServices };
export type { DailySessionSubmissionServices };
