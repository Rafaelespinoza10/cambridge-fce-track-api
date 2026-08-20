import type { LLMChatMessage, LLMJsonSchema } from '../llm/llm.types';
import type {
  PracticeInsights,
  PracticeLocale,
  PracticeRecommendation,
} from '../../interfaces/practice/practice-adaptive.interface';
import SYSTEM from '../../prompts/practice/adaptive-recommendation.system.md';
import USER from '../../prompts/practice/adaptive-recommendation.user.md';
export const PRACTICE_RECOMMENDATION_PROMPT_VERSION = 'practice-adaptive-recommendation-v1';
export interface PracticeCandidate {
  examCode: string;
  paperCode: string;
  partCode: string;
}
export interface PracticeRecommendationGenerator {
  generate(
    locale: PracticeLocale,
    insights: PracticeInsights,
    candidates: PracticeCandidate[],
  ): Promise<PracticeRecommendation>;
}
export interface StructuredLLM {
  completeStructured(
    messages: LLMChatMessage[],
    options: {
      responseSchema: LLMJsonSchema;
      timeoutMs?: number;
      temperature?: number;
      maxOutputTokens?: number;
    },
  ): Promise<unknown>;
}
function buildSchema(knownSkillCodes: string[], candidates: PracticeCandidate[]): LLMJsonSchema {
  const skillCodeSchema =
    knownSkillCodes.length > 0 ? { type: 'string', enum: knownSkillCodes } : { type: 'string' };
  return {
    name: 'practice_adaptive_recommendation',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'strengths', 'focusAreas', 'recommendedPractice', 'studyTips'],
      properties: {
        summary: { type: 'string' },
        strengths: { type: 'array', maxItems: 3, items: skillCodeSchema },
        focusAreas: { type: 'array', maxItems: 3, items: skillCodeSchema },
        recommendedPractice: {
          anyOf: candidates.map((c) => ({
            type: 'object',
            additionalProperties: false,
            required: ['examCode', 'paperCode', 'partCode', 'reason'],
            properties: {
              examCode: { type: 'string', enum: [c.examCode] },
              paperCode: { type: 'string', enum: [c.paperCode] },
              partCode: { type: 'string', enum: [c.partCode] },
              reason: { type: 'string' },
            },
          })),
        },
        studyTips: { type: 'array', maxItems: 3, items: { type: 'string' } },
      },
    },
  };
}
export class PracticeRecommendationGeneratorAdapter implements PracticeRecommendationGenerator {
  constructor(private readonly llm: StructuredLLM) {}
  async generate(
    locale: PracticeLocale,
    insights: PracticeInsights,
    candidates: PracticeCandidate[],
  ): Promise<PracticeRecommendation> {
    const context = JSON.stringify({
      sample: insights.sample,
      overall: insights.overall,
      byPart: insights.byPart,
      bySkill: insights.bySkill,
      strengths: insights.strengths,
      focusAreas: insights.focusAreas,
      trend: insights.trend,
      candidates,
      locale,
    });
    const knownSkillCodes = new Set(insights.bySkill.map((s) => s.code));
    const value = await this.llm.completeStructured(
      [
        { role: 'system', content: SYSTEM.trim() },
        {
          role: 'user',
          content: USER.replace('{{locale}}', locale).replace('{{context}}', context),
        },
      ],
      {
        responseSchema: buildSchema([...knownSkillCodes], candidates),
        timeoutMs: 25000,
        temperature: 0.2,
        maxOutputTokens: 700,
      },
    );
    if (
      !isRecommendation(value) ||
      !candidates.some(
        (c) =>
          c.examCode === value.recommendedPractice.examCode &&
          c.paperCode === value.recommendedPractice.paperCode &&
          c.partCode === value.recommendedPractice.partCode,
      ) ||
      !value.strengths.every((code) => knownSkillCodes.has(code)) ||
      !value.focusAreas.every((code) => knownSkillCodes.has(code))
    )
      throw new Error('AI_INVALID_RESPONSE');
    return value;
  }
}
function isRecommendation(value: unknown): value is PracticeRecommendation {
  if (!value || typeof value !== 'object') return false;
  const x = value as any;
  return (
    typeof x.summary === 'string' &&
    Array.isArray(x.strengths) &&
    x.strengths.length <= 3 &&
    Array.isArray(x.focusAreas) &&
    x.focusAreas.length <= 3 &&
    Array.isArray(x.studyTips) &&
    x.studyTips.length <= 3 &&
    x.recommendedPractice &&
    ['examCode', 'paperCode', 'partCode', 'reason'].every(
      (k) => typeof x.recommendedPractice[k] === 'string',
    )
  );
}
