import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Injection token for the configured {@link AiProvider} implementation.
 *
 * The selection happens in `AiModule` so that the business layer never imports
 * a concrete provider (and therefore never depends on a vendor SDK).
 */
export const AI_PROVIDER_TOKEN = 'AI_PROVIDER_TOKEN';

export type AiProviderName = 'openai' | 'mock';

/** A single provider request. Contains no tenant identity and no credentials. */
export interface AiRequest {
  /** Server-owned instructions. Never built from user/tenant data. */
  systemPrompt: string;
  /** Untrusted-but-structured payload. Always treated as data, never instructions. */
  userContent: string;
  /** Correlates provider call with the audit trail (used for logging only). */
  requestType: string;
}

/** Normalized provider response envelope shared by every provider. */
export interface AiResponse {
  /** Raw model output (structured JSON for this batch). */
  content: string;
  provider: AiProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Wall-clock duration of the provider call(s), including retries. */
  latencyMs: number;
}

export interface AiProviderDescriptor {
  provider: AiProviderName;
  model: string;
}

export interface AiProvider {
  readonly name: AiProviderName;
  /** Model used when {@link generate} is called without an explicit override. */
  readonly model: string;
  generate(request: AiRequest): Promise<AiResponse>;
}

/** Stable, non-vendor error taxonomy surfaced to callers and the audit trail. */
export type AiErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'AI_DISABLED'
  | 'AI_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_ERROR'
  | 'AI_INVALID_API_KEY'
  | 'AI_INVALID_REQUEST'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_MALFORMED_RESPONSE'
  | 'AI_UNKNOWN_ERROR';

export interface AiProviderErrorOptions {
  /** Whether the caller/provider may safely retry the exact same request. */
  retryable: boolean;
  /** Upstream HTTP status when available. */
  statusCode?: number;
  /** Provider-requested wait before retrying (Retry-After header). */
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * Provider failure. Carries only non-sensitive metadata: never the API key,
 * the prompt, the raw response body or upstream error headers.
 */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(code: AiErrorCode, message: string, options: AiProviderErrorOptions) {
    super(message);
    this.name = 'AiProviderError';
    this.code = code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      // Preserve the cause for diagnostics but never re-expose it as output.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Thin, vendor-neutral façade over the configured provider.
 *
 * This is the ONLY AI component the business layer is allowed to depend on.
 */
@Injectable()
export class AiProviderService {
  constructor(
    @Inject(AI_PROVIDER_TOKEN) private readonly provider: AiProvider,
    private readonly config: ConfigService,
  ) {}

  /** Global AI kill-switch (`AI_ENABLED`). Defaults to disabled. */
  isEnabled(): boolean {
    return this.config.get<string>('AI_ENABLED') === 'true';
  }

  describe(): AiProviderDescriptor {
    return { provider: this.provider.name, model: this.provider.model };
  }

  /**
   * Executes a provider request. Timeout, bounded retry and error
   * classification are the provider implementation's responsibility.
   */
  generate(request: AiRequest): Promise<AiResponse> {
    if (!this.isEnabled()) {
      return Promise.reject(
        new AiProviderError('AI_DISABLED', 'AI features are disabled for this deployment', {
          retryable: false,
        }),
      );
    }
    return this.provider.generate(request);
  }
}
