import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AiUsage } from '../entities/ai-usage.entity';
import { AiAuditEvent } from '../entities/ai-audit-event.entity';
import { AiProviderError, AiProviderService } from './ai-provider.service';
import { AiUsageLimitService } from './ai-usage-limit.service';
import { estimateCostUsd } from '../config/ai-pricing';
import { AiOutputValidationError } from '../dto/retention-response.dto';

export const AI_REQUEST_TYPE_RETENTION = 'retention-analysis';
/**
 * Second, independent AI use case: read-only membership-plan portfolio
 * analysis. Declared here because `AiService`/`AiUsageLimitService` key their
 * rate-limit counters on the request type, so every use case needs exactly one
 * stable, server-owned label.
 */
export const AI_REQUEST_TYPE_PLAN_PERFORMANCE = 'plan-performance-analysis';

const MAX_AUDIT_SUMMARY_LENGTH = 500;

export interface AiExecutionRequest<T> {
  /** Authorized organization (resolved via TenantContextService, never client input). */
  organizationId: string;
  /** Authenticated user id (from the verified JWT). */
  userId: string;
  requestType: string;
  /** Server-owned instructions. */
  systemPrompt: string;
  /** Structured, organization-scoped dataset. */
  userContent: string;
  /** Short, non-sensitive description stored in the audit trail. */
  promptSummary: string;
  /** Validates + normalizes the untrusted model output. */
  parseModelOutput: (raw: unknown) => T;
  /** Short, non-sensitive description of the parsed result. */
  summarizeResult: (data: T) => string;
}

/**
 * Telemetry only needs the request metadata, never the (generic) callbacks.
 * Deriving it via `Omit` keeps `execute<T>` assignable regardless of `T`.
 */
type AiExecutionRequestMetadata = Omit<
  AiExecutionRequest<unknown>,
  'parseModelOutput' | 'summarizeResult'
>;

/**
 * Business-facing AI gateway.
 *
 * Owns exactly three concerns: orchestration, usage/audit persistence, and
 * translating provider failures into HTTP semantics. It has no knowledge of
 * OpenAI (or any other vendor) — only of {@link AiProviderService}.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly aiProviderService: AiProviderService,
    private readonly usageLimitService: AiUsageLimitService,
    @InjectRepository(AiUsage)
    private readonly usageRepository: Repository<AiUsage>,
    @InjectRepository(AiAuditEvent)
    private readonly auditRepository: Repository<AiAuditEvent>,
  ) {}

  isEnabled(): boolean {
    return this.aiProviderService.isEnabled();
  }

  async execute<T>(request: AiExecutionRequest<T>): Promise<T> {
    if (!this.aiProviderService.isEnabled()) {
      throw new ServiceUnavailableException('AI features are disabled for this organization');
    }

    const descriptor = this.aiProviderService.describe();
    const promptHash = createHash('sha256')
      .update(request.systemPrompt)
      .update('\n')
      .update(request.userContent)
      .digest('hex');
    const startedAt = Date.now();

    // Provider-reported usage of the call that just completed. Captured before
    // the output is parsed so a call that was really billed but produced an
    // unusable response is still accounted for: a failure must never invent
    // tokens, but it must not discard real ones either.
    let providerUsage: {
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    } | null = null;

    try {
      const response = await this.aiProviderService.generate({
        systemPrompt: request.systemPrompt,
        userContent: request.userContent,
        requestType: request.requestType,
      });
      providerUsage = {
        provider: response.provider,
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.totalTokens,
      };

      const parsedRaw = parseJsonOutput(response.content);
      const data = request.parseModelOutput(parsedRaw);

      await this.persistTelemetry({
        request,
        provider: response.provider,
        model: response.model,
        promptHash,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.totalTokens,
        responseSummary: request.summarizeResult(data),
        success: true,
        errorCode: null,
      });

      return data;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const errorCode = classifyErrorCode(error);

      await this.persistTelemetry({
        request,
        // A provider that answered before the failure keeps its identity and
        // its real usage; a provider that never answered reports zero.
        provider: providerUsage?.provider ?? descriptor.provider,
        model: providerUsage?.model ?? descriptor.model,
        promptHash,
        latencyMs: Date.now() - startedAt,
        inputTokens: providerUsage?.inputTokens ?? 0,
        outputTokens: providerUsage?.outputTokens ?? 0,
        totalTokens: providerUsage?.totalTokens ?? 0,
        responseSummary: null,
        success: false,
        errorCode,
      });

      this.logger.error(
        `AI ${request.requestType} failed for organization ${request.organizationId}: ${errorCode}`,
      );

      throw toHttpException(error, errorCode);
    }
  }

  /**
   * Best-effort telemetry persistence.
   *
   * A persistence hiccup must not turn a completed analysis into a 5xx for the
   * caller, but it must never be silent either: failures are logged at ERROR
   * level so the audit gap stays observable.
   */
  private async persistTelemetry(params: {
    request: AiExecutionRequestMetadata;
    provider: string;
    model: string;
    promptHash: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    responseSummary: string | null;
    success: boolean;
    errorCode: string | null;
  }): Promise<void> {
    const { request } = params;
    const estimatedCostUsd = estimateCostUsd(params.model, params.inputTokens, params.outputTokens);

    try {
      await this.usageRepository.insert({
        organization_id: request.organizationId,
        user_id: request.userId,
        request_type: request.requestType,
        provider: params.provider,
        model: params.model,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        total_tokens: params.totalTokens,
        latency_ms: params.latencyMs,
        estimated_cost_usd: estimatedCostUsd,
        success: params.success,
        error_code: params.errorCode,
      });
    } catch (error) {
      this.logger.error(
        `AI usage record could not be persisted for organization ${request.organizationId}: ${errorMessage(error)}`,
      );
    }

    // Usage counters follow the provider-reported usage of THIS single call,
    // once, whether or not the insert above succeeded: tokens already consumed
    // (and billed) upstream must not vanish from the fast counters because a
    // telemetry write failed. `recordUsage` never throws.
    await this.usageLimitService.recordUsage({
      organizationId: request.organizationId,
      totalTokens: params.totalTokens,
      estimatedCostUsd,
    });

    try {
      await this.auditRepository.insert({
        organization_id: request.organizationId,
        user_id: request.userId,
        request_type: request.requestType,
        provider: params.provider,
        model: params.model,
        prompt_hash: params.promptHash,
        prompt_summary: truncate(request.promptSummary, MAX_AUDIT_SUMMARY_LENGTH),
        response_summary: params.responseSummary
          ? truncate(params.responseSummary, MAX_AUDIT_SUMMARY_LENGTH)
          : null,
        tool_calls: null,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        success: params.success,
        error_code: params.errorCode,
      });
    } catch (error) {
      this.logger.error(
        `AI audit event could not be persisted for organization ${request.organizationId}: ${errorMessage(error)}`,
      );
    }
  }
}

function parseJsonOutput(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new AiOutputValidationError('AI output is not valid JSON');
  }
}

function classifyErrorCode(error: unknown): string {
  if (error instanceof AiProviderError) {
    return error.code;
  }
  if (error instanceof AiOutputValidationError) {
    return error.code;
  }
  return 'AI_UNKNOWN_ERROR';
}

/**
 * Maps provider/validation failures onto HTTP semantics without leaking
 * upstream bodies, credentials or prompt content to the caller.
 */
function toHttpException(error: unknown, errorCode: string): HttpException {
  if (error instanceof AiProviderError) {
    switch (error.code) {
      case 'AI_DISABLED':
      case 'AI_NOT_CONFIGURED':
        return new ServiceUnavailableException('AI features are not available');
      case 'AI_TIMEOUT':
        return new GatewayTimeoutException('AI provider timed out');
      case 'AI_RATE_LIMITED':
        return new HttpException(
          'AI provider rate limit exceeded, please retry later',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'AI_PROVIDER_UNAVAILABLE':
        return new ServiceUnavailableException('AI provider is temporarily unavailable');
      case 'AI_INVALID_API_KEY':
        return new ServiceUnavailableException('AI features are not available');
      case 'AI_PROVIDER_ERROR':
      case 'AI_INVALID_REQUEST':
      case 'AI_EMPTY_RESPONSE':
      case 'AI_MALFORMED_RESPONSE':
        return new BadGatewayException('AI provider returned an unusable response');
      default:
        return new InternalServerErrorException('AI request failed');
    }
  }

  if (error instanceof AiOutputValidationError) {
    return new BadGatewayException('AI provider returned an unusable response');
  }

  return new InternalServerErrorException(`AI request failed (${errorCode})`);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

