import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { GenerateDailySessionService } from './generate-daily-session.service';
import { DailySessionsService } from './daily-sessions.service';
import { DailySessionsRepository } from '@repositories/daily-session/daily-sessions.repository';
import { buildCambridgeKnowledgeServices } from '../cambridge-knowledge/cambridge-knowledge-composition';

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

let _openaiClient: OpenAI | null = null;

/** Reuses the OpenAI client across Lambda warm invocations — same pattern as generate-practice-exercise-composition.ts. */
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

interface DailySessionServices {
  generateSession: GenerateDailySessionService;
  getSession: DailySessionsService;
}

async function buildDailySessionServices(): Promise<DailySessionServices> {
  const dataSource = await getDatabaseConnection();

  const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  // Grounding is best-effort: the Cambridge Knowledge Base search service
  // reuses the same OpenAI client/model, so wiring it costs nothing extra
  // here — GenerateDailySessionService degrades gracefully to "no grounding
  // material" if the Knowledge Base has nothing for the topic. Same reuse
  // as generate-practice-exercise-composition.ts.
  const { searchKnowledge } = await buildCambridgeKnowledgeServices();

  return {
    generateSession: new GenerateDailySessionService(dataSource, {
      llm,
      providerLabel: provider.name,
      modelLabel: provider.defaultModel,
      searchKnowledge,
    }),
    getSession: new DailySessionsService({
      repository: new DailySessionsRepository(dataSource),
    }),
  };
}

export { buildDailySessionServices };
export type { DailySessionServices };
