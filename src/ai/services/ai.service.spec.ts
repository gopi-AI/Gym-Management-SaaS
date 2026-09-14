import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiExecutionRequest, AiService, AI_REQUEST_TYPE_RETENTION } from './ai.service';
import { AiProviderError, AiProviderService } from './ai-provider.service';
import { AiUsageLimitService } from './ai-usage-limit.service';
import { AiUsage } from '../entities/ai-usage.entity';
import { AiAuditEvent } from '../entities/ai-audit-event.entity';
import { AiOutputValidationError } from '../dto/retention-response.dto';

/**
 * Orchestration / telemetry / tenancy tests for the AI gateway.
 *
 * Everything below runs against mocked repositories and a mocked provider
 * façade: no network, no database, no API cost.
 */
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PROMPT_HASH_PATTERN = /^[0-9a-f]{64}$/;

interface FakeResult {
  ok: boolean;
}

const buildRequest = (
  overrides: Partial<AiExecutionRequest<FakeResult>> = {},
): AiExecutionRequest<FakeResult> => ({
  organizationId: ORG_ID,
  userId: USER_ID,
  requestType: AI_REQUEST_TYPE_RETENTION,
  systemPrompt: 'server-owned system instructions',
  userContent: '{"data":{"memberships":[]}}',
  promptSummary: 'Retention analysis for 0 membership record(s)',
  parseModelOutput: (raw: unknown) => raw as FakeResult,
  summarizeResult: (data: FakeResult) => `ok=${data.ok}`,
  ...overrides,
});

const providerResponse = (overrides: Partial<Record<string, unknown>> = {}) => ({
  content: '{"ok":true}',
  provider: 'mock',
  model: 'mock-deterministic-v1',
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  latencyMs: 3,
  ...overrides,
});

describe('AiService', () => {
  let service: AiService;
  let providerService: Record<string, jest.Mock>;
  let usageRepository: Record<string, jest.Mock>;
  let auditRepository: Record<string, jest.Mock>;
  let usageLimitService: { recordUsage: jest.Mock };

  beforeEach(async () => {
    providerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      describe: jest.fn().mockReturnValue({ provider: 'mock', model: 'mock-deterministic-v1' }),
      generate: jest.fn().mockResolvedValue(providerResponse()),
    };
    usageRepository = { insert: jest.fn().mockResolvedValue(undefined) };
    auditRepository = { insert: jest.fn().mockResolvedValue(undefined) };
    usageLimitService = { recordUsage: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: AiProviderService, useValue: providerService },
        { provide: AiUsageLimitService, useValue: usageLimitService },
        { provide: getRepositoryToken(AiUsage), useValue: usageRepository },
        { provide: getRepositoryToken(AiAuditEvent), useValue: auditRepository },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  const usageInsertPayload = () => usageRepository.insert.mock.calls[0][0];
  const auditInsertPayload = () => auditRepository.insert.mock.calls[0][0];

  describe('successful execution', () => {
    it('returns the parsed result and records usage scoped to the authorized tenant', async () => {
      const result = await service.execute(buildRequest());

      expect(result).toEqual({ ok: true });
      expect(providerService.generate).toHaveBeenCalledWith({
        systemPrompt: 'server-owned system instructions',
        userContent: '{"data":{"memberships":[]}}',
        requestType: AI_REQUEST_TYPE_RETENTION,
      });

      const usage = usageInsertPayload();
      expect(usage).toMatchObject({
        organization_id: ORG_ID,
        user_id: USER_ID,
        request_type: AI_REQUEST_TYPE_RETENTION,
        provider: 'mock',
        model: 'mock-deterministic-v1',
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        success: true,
        error_code: null,
      });
      expect(typeof usage.latency_ms).toBe('number');
      expect(usageRepository.insert).toHaveBeenCalledTimes(1);
    });

    it('records an audit event with a hashed prompt and a short summary only', async () => {
      await service.execute(buildRequest());

      const audit = auditInsertPayload();
      expect(audit).toMatchObject({
        organization_id: ORG_ID,
        user_id: USER_ID,
        request_type: AI_REQUEST_TYPE_RETENTION,
        provider: 'mock',
        model: 'mock-deterministic-v1',
        prompt_summary: 'Retention analysis for 0 membership record(s)',
        response_summary: 'ok=true',
        tool_calls: null,
        success: true,
        error_code: null,
      });
      expect(audit.prompt_hash).toMatch(PROMPT_HASH_PATTERN);
      expect(JSON.stringify(audit)).not.toContain('system instructions');
      expect(JSON.stringify(audit)).not.toContain('memberships');
      expect(auditRepository.insert).toHaveBeenCalledTimes(1);
    });

    it('leaves the cost empty for an unlisted model but prices a known one', async () => {
      await service.execute(buildRequest());
      expect(usageInsertPayload().estimated_cost_usd).toBeNull();

      providerService.generate.mockResolvedValue(
        providerResponse({ model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 0 }),
      );
      await service.execute(buildRequest());

      expect(usageRepository.insert.mock.calls[1][0].estimated_cost_usd).toBe('2.500000');
    });

    it('truncates oversized audit summaries', async () => {
      await service.execute(buildRequest({ promptSummary: 'x'.repeat(600) }));

      const { prompt_summary: summary } = auditInsertPayload();
      expect(summary).toHaveLength(500);
      expect(summary.endsWith('...')).toBe(true);
    });
  });

  describe('kill-switch and failure taxonomy', () => {
    const executeAndCatch = async () => service.execute(buildRequest()).catch((cause) => cause);

    it('short-circuits to 503 when AI is disabled, without calling the provider', async () => {
      providerService.isEnabled.mockReturnValue(false);

      const error = await executeAndCatch();

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
      expect(providerService.generate).not.toHaveBeenCalled();
      expect(usageRepository.insert).not.toHaveBeenCalled();
      expect(auditRepository.insert).not.toHaveBeenCalled();
    });

    const providerFailures: Array<[string, number]> = [
      ['AI_NOT_CONFIGURED', 503],
      ['AI_DISABLED', 503],
      ['AI_INVALID_API_KEY', 503],
      ['AI_PROVIDER_UNAVAILABLE', 503],
      ['AI_TIMEOUT', 504],
      ['AI_RATE_LIMITED', 429],
      ['AI_PROVIDER_ERROR', 502],
      ['AI_INVALID_REQUEST', 502],
      ['AI_EMPTY_RESPONSE', 502],
      ['AI_MALFORMED_RESPONSE', 502],
      ['AI_UNKNOWN_ERROR', 500],
    ];

    it.each(providerFailures)(
      'maps provider failure %s to HTTP %d and records it without leaking upstream details',
      async (code, status) => {
        providerService.generate.mockRejectedValue(
          new AiProviderError(code as never, 'upstream says: token sk-secret rejected', {
            retryable: true,
            statusCode: 418,
          }),
        );

        const error = await executeAndCatch();

        expect(error).toBeInstanceOf(Error);
        expect((error as { getStatus: () => number }).getStatus()).toBe(status);
        expect((error as Error).message).not.toContain('sk-secret');
        expect(JSON.stringify(error)).not.toContain('sk-secret');

        expect(usageInsertPayload()).toMatchObject({
          organization_id: ORG_ID,
          user_id: USER_ID,
          success: false,
          error_code: code,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        });
        expect(auditInsertPayload()).toMatchObject({ success: false, error_code: code });
        expect(auditInsertPayload().response_summary).toBeNull();
      },
    );

    it('maps an unexpected internal failure to 500 with AI_UNKNOWN_ERROR', async () => {
      providerService.generate.mockRejectedValue(new Error('redis exploded'));

      const error = await executeAndCatch();

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as InternalServerErrorException).getStatus()).toBe(500);
      expect((error as Error).message).not.toContain('redis exploded');
      expect(usageInsertPayload().error_code).toBe('AI_UNKNOWN_ERROR');
    });

    it('fails closed on provider content that is not JSON', async () => {
      providerService.generate.mockResolvedValue(providerResponse({ content: 'not json' }));

      const error = await executeAndCatch();

      expect(error).toBeInstanceOf(BadGatewayException);
      expect(usageInsertPayload()).toMatchObject({
        success: false,
        error_code: 'AI_MALFORMED_RESPONSE',
      });
    });

    it('fails closed when the model output does not satisfy the response contract', async () => {
      providerService.generate.mockResolvedValue(providerResponse());

      const error = await service
        .execute(
          buildRequest({
            parseModelOutput: () => {
              throw new AiOutputValidationError('retention_rate is out of range');
            },
          }),
        )
        .catch((cause) => cause);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect((error as Error).message).not.toContain('retention_rate');
      expect(usageInsertPayload().error_code).toBe('AI_MALFORMED_RESPONSE');
      expect(auditInsertPayload().success).toBe(false);
    });

    it('rethrows an HttpException raised by a collaborator untouched', async () => {
      const conflict = new GatewayTimeoutException('gateway blew up');
      providerService.generate.mockRejectedValue(conflict);

      const error = await executeAndCatch();

      expect(error).toBe(conflict);
      expect(usageRepository.insert).not.toHaveBeenCalled();
    });
  });

  describe('telemetry resilience and tenant isolation', () => {
    let loggerSpy: jest.SpyInstance;

    beforeEach(() => {
      loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('does not fail a completed analysis when usage persistence fails', async () => {
      usageRepository.insert.mockRejectedValue(new Error('usage table unavailable'));

      await expect(service.execute(buildRequest())).resolves.toEqual({ ok: true });
      expect(auditRepository.insert).toHaveBeenCalledTimes(1);
      expect(loggerSpy).toHaveBeenCalled();
    });

    it('does not fail a completed analysis when the audit trail fails', async () => {
      auditRepository.insert.mockRejectedValue(new Error('audit table unavailable'));

      await expect(service.execute(buildRequest())).resolves.toEqual({ ok: true });
      expect(loggerSpy).toHaveBeenCalled();
    });

    it('never derives tenant identity from provider output', async () => {
      providerService.generate.mockResolvedValue(
        providerResponse({
          content: JSON.stringify({
            organization_id: 'attacker-org',
            user_id: 'attacker-user',
            ok: true,
          }),
        }),
      );

      await service.execute(buildRequest());

      expect(usageInsertPayload()).toMatchObject({ organization_id: ORG_ID, user_id: USER_ID });
      expect(auditInsertPayload()).toMatchObject({ organization_id: ORG_ID, user_id: USER_ID });
      expect(JSON.stringify(usageInsertPayload())).not.toContain('attacker-org');
      expect(JSON.stringify(auditInsertPayload())).not.toContain('attacker-org');
    });

    it('stores no raw prompt, model output or credential in telemetry', async () => {
      providerService.generate.mockResolvedValue(
        providerResponse({ content: '{"ok":true,"secret":"leaked-value"}' }),
      );

      await service.execute(buildRequest());

      const serialized = JSON.stringify([usageInsertPayload(), auditInsertPayload()]);
      expect(serialized).not.toContain('system instructions');
      expect(serialized).not.toContain('leaked-value');
      expect(usageInsertPayload()).not.toHaveProperty('prompt');
      expect(auditInsertPayload()).not.toHaveProperty('content');
    });

    it('hashes identical prompts identically and different prompts differently', async () => {
      await service.execute(buildRequest());
      await service.execute(buildRequest());

      const firstHash = auditInsertPayload().prompt_hash;
      expect(auditRepository.insert.mock.calls[1][0].prompt_hash).toBe(firstHash);

      await service.execute(buildRequest({ userContent: '{"data":{"memberships":[1]}}' }));
      expect(auditRepository.insert.mock.calls[2][0].prompt_hash).not.toBe(firstHash);
    });
  });

  describe('usage accounting for rate/token/cost budgets', () => {
    it('reports the provider-reported usage of a successful call exactly once', async () => {
      await service.execute(buildRequest());

      expect(usageLimitService.recordUsage).toHaveBeenCalledTimes(1);
      expect(usageLimitService.recordUsage).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        totalTokens: 15,
        estimatedCostUsd: null,
      });
    });

    it('reports the deterministic server-computed cost for a priced model', async () => {
      providerService.generate.mockResolvedValue(
        providerResponse({
          model: 'gpt-4o',
          inputTokens: 1_000_000,
          outputTokens: 0,
          totalTokens: 1_000_000,
        }),
      );

      await service.execute(buildRequest());

      expect(usageRepository.insert.mock.calls[0][0].estimated_cost_usd).toBe('2.500000');
      expect(usageLimitService.recordUsage).toHaveBeenCalledTimes(1);
      expect(usageLimitService.recordUsage).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        totalTokens: 1_000_000,
        estimatedCostUsd: '2.500000',
      });
    });

    it('never invents token usage when the provider never answered', async () => {
      providerService.generate.mockRejectedValue(
        new AiProviderError('AI_TIMEOUT', 'timed out', { retryable: true }),
      );

      await service.execute(buildRequest()).catch(() => undefined);

      // Retries live INSIDE the provider call, so the gateway accounts for a
      // single provider call and never double-counts it.
      expect(usageLimitService.recordUsage).toHaveBeenCalledTimes(1);
      expect(usageLimitService.recordUsage).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        totalTokens: 0,
        estimatedCostUsd: null,
      });
      expect(usageInsertPayload()).toMatchObject({ total_tokens: 0, estimated_cost_usd: null });
    });

    it('keeps real provider usage when the response cannot be used', async () => {
      providerService.generate.mockResolvedValue(providerResponse({ content: 'not json' }));

      const error = await service.execute(buildRequest()).catch((cause) => cause);

      expect(error).toBeInstanceOf(BadGatewayException);
      expect(usageInsertPayload()).toMatchObject({
        success: false,
        error_code: 'AI_MALFORMED_RESPONSE',
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      });
      expect(usageLimitService.recordUsage).toHaveBeenCalledTimes(1);
      expect(usageLimitService.recordUsage).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        totalTokens: 15,
        estimatedCostUsd: null,
      });
    });

    it('still accounts for usage when the telemetry write itself fails', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      usageRepository.insert.mockRejectedValue(new Error('usage table unavailable'));

      try {
        await service.execute(buildRequest());
        expect(usageLimitService.recordUsage).toHaveBeenCalledTimes(1);
      } finally {
        loggerSpy.mockRestore();
      }
    });
  });
});
