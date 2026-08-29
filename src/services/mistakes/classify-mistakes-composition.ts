import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { LexicalMistakeClassifier } from './classify-lexical-mistake';
import { ClassifyPendingMistakesService } from './classify-pending-mistakes.service';

/** Classification is a judgement, not a generation — no creativity wanted. */
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_OUTPUT_TOKENS = 200;

// Same per-Lambda singleton as every other AI-backed composition here.
let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (_openaiClient !== null) return _openaiClient;

  const apiKey = process.env['OPEN_AI_API_KEY'];
  if (!apiKey) {
    throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

interface ClassifyMistakesServices {
  classifyPendingMistakes: ClassifyPendingMistakesService;
}

async function buildClassifyMistakesServices(): Promise<ClassifyMistakesServices> {
  const dataSource = await getDatabaseConnection();

  const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  return {
    classifyPendingMistakes: new ClassifyPendingMistakesService({
      repository: new MistakesRepository(dataSource),
      classifier: new LexicalMistakeClassifier(llm),
    }),
  };
}

export { buildClassifyMistakesServices };
export type { ClassifyMistakesServices };
