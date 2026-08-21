import OpenAI from 'openai';
import { getDatabaseConnection } from '@lib/shared/database';
import { LLMService } from '../llm/llm.service';
import { OpenAIProvider } from '../llm/openai.provider';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { PracticeInsightsRepository } from '@repositories/practice/practice-insights.repository';
import { PracticeRecommendationsRepository } from '@repositories/practice/practice-recommendations.repository';
import { GetPracticeInsightsService } from './get-practice-insights.service';
import { GeneratePracticeRecommendationService } from './generate-practice-recommendation.service';
import { PracticeRecommendationGeneratorAdapter } from './practice-recommendation-generator';
let client: OpenAI | null = null;
let llm: LLMService | null = null;
function getLlm(): LLMService {
  if (llm) return llm;
  const key = process.env.OPEN_AI_API_KEY;
  if (!key) throw new LLMServiceError('LLM not configured', LLMErrorCode.NOT_CONFIGURED);
  client = client ?? new OpenAI({ apiKey: key });
  const provider = new OpenAIProvider(client, process.env.OPENAI_MODEL);
  llm = new LLMService({
    provider,
    defaultModel: provider.defaultModel,
    defaultTemperature: 0.2,
    defaultMaxOutputTokens: 700,
  });
  return llm;
}
export async function buildPracticeAdaptiveServices() {
  const ds = await getDatabaseConnection();
  const insightsRepository = new PracticeInsightsRepository(ds);
  const insights = new GetPracticeInsightsService(insightsRepository);
  return {
    getInsights: insights,
    generateRecommendation: new GeneratePracticeRecommendationService(
      insights,
      new PracticeRecommendationsRepository(ds),
      new PracticeRecommendationGeneratorAdapter({
        completeStructured: (m, o) => getLlm().completeStructured(m, o),
      }),
    ),
  };
}
