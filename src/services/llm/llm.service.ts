import { LLMServiceError, LLMErrorCode } from './llm.types';
import type { LLMChatMessage, LLMCompletionOptions, LLMProvider } from './llm.types';

export interface LLMServiceDeps {
  provider: LLMProvider;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxOutputTokens: number;
}

function toValidatedMessages(messages: LLMChatMessage[]): LLMChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LLMServiceError('messages must be a non-empty array', LLMErrorCode.INVALID_INPUT);
  }
  for (const message of messages) {
    if (typeof message.content !== 'string' || message.content.trim() === '') {
      throw new LLMServiceError(
        'every message must have non-empty string content',
        LLMErrorCode.INVALID_INPUT,
      );
    }
  }
  return messages;
}

/**
 * Provider-agnostic entry point every prompt to an LLM goes through, so the
 * API key and the concrete provider (OpenAI today, others later) never leak
 * past the backend. Depends only on the LLMProvider port — swap providers by
 * passing a different adapter in LLMServiceDeps, no changes needed here.
 */
export class LLMService {
  constructor(private readonly deps: LLMServiceDeps) {}

  /** Sends a single user prompt and returns the model's text response. */
  async complete(prompt: string, options: LLMCompletionOptions = {}): Promise<string> {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new LLMServiceError('prompt must be a non-empty string', LLMErrorCode.INVALID_INPUT);
    }
    return this.chat([{ role: 'user', content: prompt }], options);
  }

  /** Sends a multi-turn conversation (optionally with a system message) and returns the reply text. */
  async chat(messages: LLMChatMessage[], options: LLMCompletionOptions = {}): Promise<string> {
    const validated = toValidatedMessages(messages);

    const result = await this.deps.provider.createCompletion({
      model: options.model ?? this.deps.defaultModel,
      messages: validated,
      temperature: options.temperature ?? this.deps.defaultTemperature,
      maxOutputTokens: options.maxOutputTokens ?? this.deps.defaultMaxOutputTokens,
    });

    if (typeof result.content !== 'string' || result.content.trim() === '') {
      throw new LLMServiceError('LLM returned an empty response', LLMErrorCode.EMPTY_RESPONSE);
    }
    return result.content;
  }
}
