import { APIError, APIConnectionTimeoutError } from 'openai';
import type OpenAI from 'openai';

import { LLMServiceError, LLMErrorCode } from './llm.types';
import type {
  LLMProvider,
  LLMProviderCompletionParams,
  LLMProviderResult,
  LLMProviderStructuredCompletionParams,
  LLMProviderStructuredResult,
} from './llm.types';

const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAIClientPort {
  chat: {
    completions: {
      create(
        params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
    };
  };
  responses: {
    create(
      params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<OpenAI.Responses.Response>;
  };
}

const UNSUPPORTED_TEMPERATURE_PATTERN = /'temperature'\s+is not supported/i;

/**
 * Some models (reasoning-tier: o1/o3, gpt-5-thinking family, and others)
 * reject the `temperature` sampling parameter outright. Rather than make
 * every caller know which models support it, we optimistically send it and
 * silently retry once without it if the provider rejects it for that reason.
 */
async function withTemperatureFallback<T>(
  attempt: (includeTemperature: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await attempt(true);
  } catch (err: unknown) {
    const isUnsupportedTemperature =
      err instanceof APIError &&
      err.status === 400 &&
      UNSUPPORTED_TEMPERATURE_PATTERN.test(err.message);
    if (!isUnsupportedTemperature) throw err;
    return attempt(false);
  }
}

function mapOpenAIError(error: unknown): LLMServiceError {
  if (error instanceof APIConnectionTimeoutError) {
    return new LLMServiceError('OpenAI request timed out', LLMErrorCode.TIMEOUT);
  }
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
      response = await withTemperatureFallback((includeTemperature) =>
        this.client.chat.completions.create({
          model: params.model,
          messages: params.messages,
          max_completion_tokens: params.maxOutputTokens,
          ...(includeTemperature ? { temperature: params.temperature } : {}),
        }),
      );
    } catch (err: unknown) {
      throw mapOpenAIError(err);
    }

    const content = response.choices[0]?.message?.content;
    return { content: typeof content === 'string' ? content : '' };
  }

  /** Uses the Responses API with Structured Outputs (no tools, no web search). */
  async createStructuredCompletion(
    params: LLMProviderStructuredCompletionParams,
  ): Promise<LLMProviderStructuredResult> {
    const requestOptions =
      params.timeoutMs !== undefined ? { timeout: params.timeoutMs } : undefined;

    let response: OpenAI.Responses.Response;
    try {
      response = await withTemperatureFallback((includeTemperature) =>
        this.client.responses.create(
          {
            model: params.model,
            input: params.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            max_output_tokens: params.maxOutputTokens,
            ...(includeTemperature ? { temperature: params.temperature } : {}),
            text: {
              format: {
                type: 'json_schema',
                name: params.responseSchema.name,
                schema: params.responseSchema.schema,
                strict: params.responseSchema.strict ?? true,
              },
            },
          },
          requestOptions,
        ),
      );
    } catch (err: unknown) {
      throw mapOpenAIError(err);
    }

    return { content: typeof response.output_text === 'string' ? response.output_text : '' };
  }
}
