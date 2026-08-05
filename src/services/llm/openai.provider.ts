import { APIError } from 'openai';
import type OpenAI from 'openai';

import { LLMServiceError, LLMErrorCode } from './llm.types';
import type { LLMProvider, LLMProviderCompletionParams, LLMProviderResult } from './llm.types';

const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAIClientPort {
  chat: {
    completions: {
      create(
        params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
    };
  };
}

function mapOpenAIError(error: unknown): LLMServiceError {
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new LLMServiceError(
        'OpenAI rejected the configured API key',
        LLMErrorCode.AUTHENTICATION_FAILED,
      );
    }
    if (error.status === 429) {
      return new LLMServiceError('OpenAI rate limit exceeded', LLMErrorCode.RATE_LIMITED);
    }
    return new LLMServiceError(
      `OpenAI request failed: ${error.message}`,
      LLMErrorCode.PROVIDER_ERROR,
    );
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return new LLMServiceError(`OpenAI request failed: ${message}`, LLMErrorCode.PROVIDER_ERROR);
}

/** LLMProvider adapter backed by the OpenAI Chat Completions API. */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly defaultModel: string;

  constructor(
    private readonly client: OpenAIClientPort,
    defaultModel: string = DEFAULT_MODEL,
  ) {
    this.defaultModel = defaultModel;
  }

  async createCompletion(params: LLMProviderCompletionParams): Promise<LLMProviderResult> {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_completion_tokens: params.maxOutputTokens,
      });
    } catch (err: unknown) {
      throw mapOpenAIError(err);
    }

    const content = response.choices[0]?.message?.content;
    return { content: typeof content === 'string' ? content : '' };
  }
}
