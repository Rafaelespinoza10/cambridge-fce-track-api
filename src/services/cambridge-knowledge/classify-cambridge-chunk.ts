/// <reference path="../../types/markdown.d.ts" />
import type {
  LLMChatMessage,
  LLMJsonSchema,
  LLMStructuredCompletionOptions,
} from '../llm/llm.types';
import { renderPromptTemplate } from '@lib/llm/prompt-template';
import {
  CAMBRIDGE_EXAM_CODE,
  CAMBRIDGE_SKILL_SLUGS,
  isCambridgePaperCode,
  isCambridgePartCode,
  isCambridgeSkillSlug,
  isCambridgeTopic,
} from '@lib/cambridge-knowledge/cambridge-knowledge-catalog';
import { EXAM_TOPICS } from '@lib/shared/exam-topics';
import { PRACTICE_EXAM_CATALOG, findExamInCatalog } from '@lib/practice/practice-exam-catalog';
import SYSTEM_PROMPT from '../../prompts/cambridge-knowledge/classify-chunk.system.md';
import USER_PROMPT_TEMPLATE from '../../prompts/cambridge-knowledge/classify-chunk.user.md';

export interface CambridgeChunkClassification {
  paperCode: string | null;
  partCode: string | null;
  skills: string[];
  topics: string[];
}

/** Same shape as SubmitWritingSubmissionService's LLMServicePort — the only method any classifier/grader needs from LLMService. */
export interface LLMServicePort {
  completeStructured(
    messages: LLMChatMessage[],
    options: LLMStructuredCompletionOptions,
  ): Promise<unknown>;
}

export interface CambridgeChunkClassifier {
  classify(content: string, sourcePage: number): Promise<CambridgeChunkClassification>;
}

const REQUEST_TIMEOUT_MS = 20_000;
const RESPONSE_TEMPERATURE = 0.1;
const RESPONSE_MAX_OUTPUT_TOKENS = 300;
const MAX_SKILLS = 3;
const MAX_TOPICS = 3;

// Derived mechanically from PRACTICE_EXAM_CATALOG (real, Cambridge-verified
// structure) — never hardcoded/invented here. All part codes across all
// papers are offered to the schema loosely; the (paperCode, partCode) PAIR
// is what actually gets cross-validated after the call (see validate()),
// same "loose schema, strict post-validation" split submit-writing-
// submission.service.ts uses for its own AI response.
function catalogPaperCodes(): string[] {
  return (findExamInCatalog(PRACTICE_EXAM_CATALOG, CAMBRIDGE_EXAM_CODE)?.papers ?? []).map(
    (paper) => paper.code,
  );
}

function catalogPartCodes(): string[] {
  const papers = findExamInCatalog(PRACTICE_EXAM_CATALOG, CAMBRIDGE_EXAM_CODE)?.papers ?? [];
  return papers.flatMap((paper) => paper.parts.map((part) => part.code));
}

function buildSchema(): LLMJsonSchema {
  return {
    name: 'cambridge_chunk_classification',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['paperCode', 'partCode', 'skills', 'topics'],
      properties: {
        paperCode: {
          anyOf: [{ type: 'string', enum: catalogPaperCodes() }, { type: 'null' }],
        },
        partCode: {
          anyOf: [{ type: 'string', enum: catalogPartCodes() }, { type: 'null' }],
        },
        skills: {
          type: 'array',
          maxItems: MAX_SKILLS,
          items: { type: 'string', enum: [...CAMBRIDGE_SKILL_SLUGS] },
        },
        topics: {
          type: 'array',
          maxItems: MAX_TOPICS,
          items: { type: 'string', enum: [...EXAM_TOPICS] },
        },
      },
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Never throws on an implausible classification — per the "Si no puede
 * determinarse, usar null/lista vacía" requirement, an AI response that
 * names a paper/part/skill/topic outside the verified catalog is degraded
 * (that one field nulled out or dropped), not rejected wholesale. The only
 * thing this DOES throw on is a response that isn't even shaped like a
 * classification (missing arrays) — that's a provider/schema failure, not a
 * classification the caller could reasonably act on.
 */
export function validateClassification(value: unknown): CambridgeChunkClassification {
  if (!isPlainObject(value)) throw new Error('CAMBRIDGE_CLASSIFICATION_INVALID_RESPONSE');
  if (!Array.isArray(value.skills) || !Array.isArray(value.topics)) {
    throw new Error('CAMBRIDGE_CLASSIFICATION_INVALID_RESPONSE');
  }

  const paperCodeRaw = typeof value.paperCode === 'string' ? value.paperCode : null;
  const paperCode =
    paperCodeRaw !== null && isCambridgePaperCode(paperCodeRaw) ? paperCodeRaw : null;

  const partCodeRaw = typeof value.partCode === 'string' ? value.partCode : null;
  // A partCode is only ever kept when it's jointly valid for the (already
  // validated) paperCode — never invented, never orphaned from its paper.
  const partCode =
    paperCode !== null && partCodeRaw !== null && isCambridgePartCode(paperCode, partCodeRaw)
      ? partCodeRaw
      : null;

  const skills = [...new Set(value.skills.filter(isCambridgeSkillSlug))].slice(0, MAX_SKILLS);
  const topics = [...new Set(value.topics.filter(isCambridgeTopic))].slice(0, MAX_TOPICS);

  return { paperCode, partCode, skills, topics };
}

/** Structured-output classifier — mirrors PracticeRecommendationGeneratorAdapter's shape (port + schema + post-validation). */
export class CambridgeChunkClassifierAdapter implements CambridgeChunkClassifier {
  constructor(private readonly llm: LLMServicePort) {}

  async classify(content: string, sourcePage: number): Promise<CambridgeChunkClassification> {
    const userPrompt = renderPromptTemplate(USER_PROMPT_TEMPLATE, {
      sourcePage: String(sourcePage),
      content,
    });
    const messages: LLMChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT.trim() },
      { role: 'user', content: userPrompt },
    ];

    const raw = await this.llm.completeStructured(messages, {
      responseSchema: buildSchema(),
      timeoutMs: REQUEST_TIMEOUT_MS,
      temperature: RESPONSE_TEMPERATURE,
      maxOutputTokens: RESPONSE_MAX_OUTPUT_TOKENS,
    });

    return validateClassification(raw);
  }
}
