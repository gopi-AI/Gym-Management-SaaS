import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  AiProviderError,
  AiRequest,
  AiResponse,
} from '../services/ai-provider.service';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 4_000;
const MAX_RETRY_AFTER_MS = 10_000;

interface OpenAiChatCompletion {
  model?: unknown;
  choices?: unknown;
  usage?: unknown;
}

/**
 * OpenAI Chat Completions provider.
 *
 * Deliberate design notes for this batch:
 * - uses the platform `fetch` against the documented OpenAI REST API so the
 *   codebase gains no new runtime SDK dependency (the business layer never
 *   imports vendor code — it only knows the {@link AiProvider} contract);
 * - every call is bounded by `AI_TIMEOUT_MS` through an AbortController;
 * - failed calls are retried at most `AI_MAX_RETRIES` times, and only for
 *   genuinely transient failures (timeout / 429 / 5xx / network);
 * - 4xx configuration and request errors are never retried;
 * - the API key is read from config on demand and is never logged, embedded in
 *   error messages, persisted, or returned to a caller;
 * - the prompt and the raw response body are never logged.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;

  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('AI_MODEL')?.trim() || DEFAULT_MODEL;
  }

  async generate(request: AiRequest): Promise<AiResponse> {
    const apiKey = this.getApiKey();
    const maxRetries = this.getMaxRetries();
    const startedAt = Date.now();

    let attempt = 0;
    let lastError: AiProviderError | undefined;

    for (;;) {
      attempt += 1;
      try {
        const completion = await this.requestCompletion(apiKey, request);
        return { ...completion, latencyMs: Date.now() - startedAt };
      } catch (error) {
        const providerError =
          error instanceof AiProviderError
            ? error
            : new AiProviderError('AI_UNKNOWN_ERROR', 'Unexpected OpenAI provider failure', {
                retryable: false,
                cause: error,
              });
        lastError = providerError;

        if (!providerError.retryable || attempt > maxRetries) {
          break;
        }

        const delayMs = this.resolveRetryDelay(providerError, attempt);
        this.logger.warn(
          `OpenAI request failed (${providerError.code}); retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries + 1})`,
        );
        await sleep(delayMs);
      }
    }

    const finalError =
      lastError ??
      new AiProviderError('AI_UNKNOWN_ERROR', 'OpenAI provider failed', { retryable: false });
    this.logger.error(`OpenAI request failed after ${attempt} attempt(s): ${finalError.code}`);
    throw finalError;
  }

  private async requestCompletion(
    apiKey: string,
    request: AiRequest,
  ): Promise<Omit<AiResponse, 'latencyMs'>> {
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(this.buildBody(request)),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new AiProviderError(
          'AI_TIMEOUT',
          `OpenAI request exceeded the ${timeoutMs}ms timeout`,
          { retryable: true },
        );
      }
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'OpenAI endpoint is unreachable', {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.classifyHttpStatus(response.status, response.headers.get('retry-after'));
    }

    let payload: OpenAiChatCompletion;
    try {
      payload = (await response.json()) as OpenAiChatCompletion;
    } catch (error) {
      throw new AiProviderError('AI_MALFORMED_RESPONSE', 'OpenAI returned a non-JSON body', {
        retryable: false,
        cause: error,
      });
    }

    const content = extractMessageContent(payload);
    if (content === null) {
      throw new AiProviderError('AI_EMPTY_RESPONSE', 'OpenAI returned no message content', {
        retryable: false,
      });
    }
    if (!isJsonObject(content)) {
      throw new AiProviderError(
        'AI_MALFORMED_RESPONSE',
        'OpenAI returned content that is not a JSON object',
        { retryable: false },
      );
    }

    const usage = extractUsage(payload);

    return {
      content,
      provider: this.name,
      model: typeof payload.model === 'string' && payload.model ? payload.model : this.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    };
  }

  private buildBody(request: AiRequest): Record<string, unknown> {
    return {
      model: this.model,
      temperature: this.getTemperature(),
      max_tokens: this.getMaxTokens(),
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
    };
  }

  private classifyHttpStatus(status: number, retryAfterHeader: string | null): AiProviderError {
    if (status === 401 || status === 403) {
      return new AiProviderError(
        'AI_INVALID_API_KEY',
        'OpenAI rejected the configured credentials',
        { retryable: false, statusCode: status },
      );
    }
    if (status === 429) {
      return new AiProviderError('AI_RATE_LIMITED', 'OpenAI rate limit reached', {
        retryable: true,
        statusCode: status,
        retryAfterMs: parseRetryAfter(retryAfterHeader),
      });
    }
    if (status === 408 || status === 425) {
      return new AiProviderError('AI_TIMEOUT', 'OpenAI reported a request timeout', {
        retryable: true,
        statusCode: status,
      });
    }
    if (status >= 500) {
      return new AiProviderError('AI_PROVIDER_ERROR', 'OpenAI reported a server error', {
        retryable: true,
        statusCode: status,
      });
    }
    return new AiProviderError('AI_INVALID_REQUEST', 'OpenAI rejected the request payload', {
      retryable: false,
      statusCode: status,
    });
  }

  private resolveRetryDelay(error: AiProviderError, attempt: number): number {
    if (typeof error.retryAfterMs === 'number') {
      return Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS);
    }
    return Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  }

  private getApiKey(): string {
    const apiKey = this.config.get<string>('AI_API_KEY')?.trim();
    if (!apiKey) {
      throw new AiProviderError(
        'AI_NOT_CONFIGURED',
        'OpenAI provider requires AI_API_KEY to be configured',
        { retryable: false },
      );
    }
    return apiKey;
  }

  private getEndpoint(): string {
    const baseUrl = this.config.get<string>('AI_BASE_URL')?.trim() || DEFAULT_BASE_URL;
    return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private getTimeoutMs(): number {
    return clampInt(this.config.get<string>('AI_TIMEOUT_MS'), DEFAULT_TIMEOUT_MS, 1_000, 120_000);
  }

  private getMaxRetries(): number {
    return clampInt(this.config.get<string>('AI_MAX_RETRIES'), DEFAULT_MAX_RETRIES, 0, 5);
  }

  private getMaxTokens(): number {
    return clampInt(this.config.get<string>('AI_MAX_TOKENS'), DEFAULT_MAX_TOKENS, 1, 16_000);
  }

  private getTemperature(): number {
    const raw = Number(this.config.get<string>('AI_TEMPERATURE'));
    if (!Number.isFinite(raw)) {
      return DEFAULT_TEMPERATURE;
    }
    return Math.min(Math.max(raw, 0), 2);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function extractMessageContent(payload: OpenAiChatCompletion): string | null {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    return null;
  }
  const first = payload.choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return null;
  }
  return content;
}

function extractUsage(payload: OpenAiChatCompletion): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const usage = payload.usage as
    | { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
    | undefined;
  const inputTokens = toNonNegativeInt(usage?.prompt_tokens);
  const outputTokens = toNonNegativeInt(usage?.completion_tokens);
  const totalTokens = toNonNegativeInt(usage?.total_tokens) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function toNonNegativeInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function isJsonObject(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(dateMs - Date.now(), 0);
  }
  return undefined;
}
