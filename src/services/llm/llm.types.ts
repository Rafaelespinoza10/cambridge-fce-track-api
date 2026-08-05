export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMChatMessage {
  role: LLMRole;
  content: string;
}

export interface LLMCompletionOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LLMProviderCompletionParams {
  model: string;
  messages: LLMChatMessage[];
  temperature: number;
  maxOutputTokens: number;
}

export interface LLMProviderResult {
  content: string;
}

/** A strict JSON Schema response format for Structured Outputs. */
export interface LLMJsonSchema {
  name: string;
  schema: Record<string, unknown>;
  /** Defaults to true — the provider must match the schema exactly. */
  strict?: boolean;
}

export interface LLMStructuredCompletionOptions extends LLMCompletionOptions {
  responseSchema: LLMJsonSchema;
  /** Aborts the request if the provider hasn't responded within this many ms. */
  timeoutMs?: number;
}

export interface LLMProviderStructuredCompletionParams {
  model: string;
  messages: LLMChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  responseSchema: LLMJsonSchema;
  timeoutMs?: number;
}

export interface LLMProviderStructuredResult {
  /** Raw JSON text from the provider — LLMService parses and validates it. */
  content: string;
}

/**
 * Port every LLM provider adapter must implement (OpenAI, and — later —
 * Anthropic, Gemini, etc.). LLMService only ever talks to this interface,
 * never to a provider's own SDK types, so swapping providers means adding a
 * new adapter, not touching LLMService.
 */
export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  createCompletion(params: LLMProviderCompletionParams): Promise<LLMProviderResult>;
  createStructuredCompletion(
    params: LLMProviderStructuredCompletionParams,
  ): Promise<LLMProviderStructuredResult>;
}

export enum LLMErrorCode {
  NOT_CONFIGURED = 'not_configured',
  INVALID_INPUT = 'invalid_input',
  AUTHENTICATION_FAILED = 'authentication_failed',
  RATE_LIMITED = 'rate_limited',
  PROVIDER_ERROR = 'provider_error',
  EMPTY_RESPONSE = 'empty_response',
  INVALID_JSON_RESPONSE = 'invalid_json_response',
  TIMEOUT = 'timeout',
}

const LLM_ERROR_STATUS_BY_CODE: Record<LLMErrorCode, number> = {
  [LLMErrorCode.NOT_CONFIGURED]: 500,
  [LLMErrorCode.INVALID_INPUT]: 400,
  [LLMErrorCode.AUTHENTICATION_FAILED]: 500,
  [LLMErrorCode.RATE_LIMITED]: 429,
  [LLMErrorCode.PROVIDER_ERROR]: 502,
  [LLMErrorCode.EMPTY_RESPONSE]: 502,
  [LLMErrorCode.INVALID_JSON_RESPONSE]: 502,
  [LLMErrorCode.TIMEOUT]: 504,
};

export class LLMServiceError extends Error {
  readonly statusCode: number;

  constructor(
    message: string,
    readonly code: LLMErrorCode,
  ) {
    super(message);
    this.name = 'LLMServiceError';
    this.statusCode = LLM_ERROR_STATUS_BY_CODE[code];
  }
}
