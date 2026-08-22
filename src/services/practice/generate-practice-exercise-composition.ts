import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { GeneratePracticeExerciseService } from './generate-practice-exercise.service';
import { PracticeExercisesService } from './practice-exercises.service';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { buildCambridgeKnowledgeSearchServices } from '../cambridge-knowledge/cambridge-knowledge-search-composition';

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

interface PracticeExerciseServices {
  generateExercise: GeneratePracticeExerciseService;
  getExercise: PracticeExercisesService;
}

async function buildPracticeExerciseServices(): Promise<PracticeExerciseServices> {
  const dataSource = await getDatabaseConnection();

  const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  // Grounding is best-effort: GeneratePracticeExerciseService only ever
  // consults it for parts flagged groundingRecommended (Reading), and
  // degrades gracefully to "no grounding material" if the Knowledge Base has
  // nothing for the topic. Uses the SEARCH-ONLY composition on purpose — the
  // full one pulls the admin PDF-import pipeline (and `pdf-parse`, which
  // crashes a bundled Lambda on cold start) into this function's graph.
  const { searchKnowledge } = await buildCambridgeKnowledgeSearchServices();

  return {
    generateExercise: new GeneratePracticeExerciseService(dataSource, {
      llm,
      providerLabel: provider.name,
      modelLabel: provider.defaultModel,
      searchKnowledge,
    }),
    getExercise: new PracticeExercisesService({
      repository: new PracticeExercisesRepository(dataSource),
    }),
  };
}

export { buildPracticeExerciseServices };
export type { PracticeExerciseServices };
