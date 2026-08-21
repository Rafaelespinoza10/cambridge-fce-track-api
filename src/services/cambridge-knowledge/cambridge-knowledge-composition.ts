import OpenAI from 'openai';

import { getDatabaseConnection } from '../../lib/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { OpenAIEmbeddingClient } from './embed-cambridge-chunks';
import { CambridgeChunkClassifierAdapter } from './classify-cambridge-chunk';
import { ImportCambridgeKnowledgeService } from './import-cambridge-knowledge.service';
import { SearchCambridgeKnowledgeService } from './search-cambridge-knowledge.service';
import { ListCambridgeSourcesService } from './list-cambridge-sources.service';
import { CambridgeSourcesRepository } from '../../repositories/cambridge-sources.repository';

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 500;

let _openaiClient: OpenAI | null = null;

/** Reuses the OpenAI client across Lambda warm invocations — same pattern as generate-writing-task-composition.ts. */
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

interface CambridgeKnowledgeServices {
  importKnowledge: ImportCambridgeKnowledgeService;
  searchKnowledge: SearchCambridgeKnowledgeService;
  listSources: ListCambridgeSourcesService;
}

async function buildCambridgeKnowledgeServices(): Promise<CambridgeKnowledgeServices> {
  const dataSource = await getDatabaseConnection();
  const client = getOpenAIClient();

  const provider = new OpenAIProvider(client, process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });
  const classifier = new CambridgeChunkClassifierAdapter(llm);
  const embeddingClient = new OpenAIEmbeddingClient(client, process.env['OPENAI_EMBEDDING_MODEL']);

  return {
    importKnowledge: new ImportCambridgeKnowledgeService(dataSource, {
      classifier,
      embeddingClient,
    }),
    searchKnowledge: new SearchCambridgeKnowledgeService(dataSource, { embeddingClient }),
    listSources: new ListCambridgeSourcesService({
      repository: new CambridgeSourcesRepository(dataSource),
    }),
  };
}

export { buildCambridgeKnowledgeServices };
export type { CambridgeKnowledgeServices };
