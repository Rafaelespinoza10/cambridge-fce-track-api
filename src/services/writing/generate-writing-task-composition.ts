import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { GenerateWritingTaskService } from './generate-writing-task.service';
import { WritingTasksService } from './writing-tasks.service';
import { WritingTasksRepository } from '@repositories/writing/writing-tasks.repository';

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

interface WritingTaskServices {
  generateTask: GenerateWritingTaskService;
  getTask: WritingTasksService;
}

async function buildWritingTaskServices(): Promise<WritingTaskServices> {
  const dataSource = await getDatabaseConnection();

  const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  return {
    generateTask: new GenerateWritingTaskService(dataSource, {
      llm,
      providerLabel: provider.name,
      modelLabel: provider.defaultModel,
    }),
    getTask: new WritingTasksService({
      repository: new WritingTasksRepository(dataSource),
    }),
  };
}

export { buildWritingTaskServices };
export type { WritingTaskServices };
