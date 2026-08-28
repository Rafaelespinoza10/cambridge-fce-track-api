import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { GenerateMistakePracticeExerciseService } from './generate-mistake-practice-exercise.service';
import { PracticeExercisesRepository } from '@repositories/practice/practice-exercises.repository';
import { MistakesRepository } from '@repositories/mistakes/mistakes.repository';

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

// Same per-Lambda singleton pattern as generate-practice-exercise-
// composition.ts (and every other AI-backed composition in this codebase) —
// reused across warm invocations of THIS function only.
let _openaiClient: OpenAI | null = null;

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

interface MistakePracticeGenerationServices {
  generateMistakePractice: GenerateMistakePracticeExerciseService;
}

async function buildMistakePracticeGenerationServices(): Promise<MistakePracticeGenerationServices> {
  const dataSource = await getDatabaseConnection();

  const provider = new OpenAIProvider(getOpenAIClient(), process.env['OPENAI_MODEL']);
  const llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: DEFAULT_TEMPERATURE,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  return {
    generateMistakePractice: new GenerateMistakePracticeExerciseService(dataSource, {
      llm,
      providerLabel: provider.name,
      modelLabel: provider.defaultModel,
      practiceExercises: (source) => new PracticeExercisesRepository(source),
      mistakes: (source) => new MistakesRepository(source),
    }),
  };
}

export { buildMistakePracticeGenerationServices };
export type { MistakePracticeGenerationServices };
