import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './openai.provider';
import { AiProviderError, AiRequest } from '../services/ai-provider.service';

/**
 * Provider taxonomy tests.
 *
 * The OpenAI provider is the only place that talks to the network, so these
 * tests pin: the request shape, the error classification (retryable vs not),
 * bounded retries, and the guarantee that credentials never leak into errors.
 * `fetch` is mocked — no network access and no API cost.
 */
const API_KEY = 'sk-test-secret-value';
const ENDPOINT = 'https://api.test/v1/chat/completions';

const buildConfig = (overrides: Record<string, string | undefined> = {}) =>
  ({
    get: (key: string) =>
      ({
        AI_API_KEY: API_KEY,
        AI_MAX_RETRIES: '0',
        AI_BASE_URL: 'https://api.test/v1',
        ...overrides,
      })[key],
  }) as unknown as ConfigService;

const request: AiRequest = {
  systemPrompt: 'system instructions',
  userContent: '{"data":{"memberships":[]}}',
  requestType: 'retention-analysis',
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const completion = (
  content: string,
  usage: Record<string, number> = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
) => ({
  model: 'gpt-4o-2024-08-06',
  choices: [{ message: { content } }],
  usage,
});

const expectProviderError = async (
  promise: Promise<unknown>,
  expected: { code: string; retryable: boolean },
): Promise<AiProviderError> => {
  const error = (await promise.catch((cause) => cause)) as AiProviderError;
  expect(error).toBeInstanceOf(AiProviderError);
  expect(error.code).toBe(expected.code);
  expect(error.retryable).toBe(expected.retryable);
  return error;
};

describe('OpenAiProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('successful completion', () => {
    it('posts a bounded, JSON-mode chat completion and normalizes the response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(completion('{"retention_rate":0.5}')));

      const provider = new OpenAiProvider(buildConfig());
      const response = await provider.generate(request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(ENDPOINT);
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
      });

      const body = JSON.parse(init.body as string);
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.stream).toBe(false);
      expect(body.temperature).toBe(0);
      expect(body.messages).toEqual([
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ]);

      expect(response.content).toBe('{"retention_rate":0.5}');
      expect(response.provider).toBe('openai');
      expect(response.model).toBe('gpt-4o-2024-08-06');
      expect(response.inputTokens).toBe(10);
      expect(response.outputTokens).toBe(5);
      expect(response.totalTokens).toBe(15);
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('falls back to the configured model when the response omits it', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: '{"a":1}' } }] }),
      );

      const provider = new OpenAiProvider(buildConfig({ AI_MODEL: 'gpt-4o-mini' }));
      const response = await provider.generate(request);

      expect(response.model).toBe('gpt-4o-mini');
      expect(response.totalTokens).toBe(0);
    });
  });

  describe('error taxonomy', () => {
    it('classifies 401 as a non-retryable credential failure without leaking the key', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { message: 'invalid api key' } }, { status: 401 }),
      );

      const provider = new OpenAiProvider(buildConfig());
      const error = await expectProviderError(provider.generate(request), {
        code: 'AI_INVALID_API_KEY',
        retryable: false,
      });

      expect(error.statusCode).toBe(401);
      expect(error.message).not.toContain(API_KEY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries 429 up to AI_MAX_RETRIES and then rethrows as retryable', async () => {
      fetchMock.mockResolvedValue(
        new Response('', { status: 429, headers: { 'retry-after': '0' } }),
      );

      const provider = new OpenAiProvider(buildConfig({ AI_MAX_RETRIES: '2' }));
      const error = await expectProviderError(provider.generate(request), {
        code: 'AI_RATE_LIMITED',
        retryable: true,
      });

      expect(error.statusCode).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('classifies 5xx as a retryable provider failure', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }));

      const provider = new OpenAiProvider(buildConfig());
      const error = await expectProviderError(provider.generate(request), {
        code: 'AI_PROVIDER_ERROR',
        retryable: true,
      });

      expect(error.statusCode).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never retries a 4xx request error', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { message: 'context too long' } }, { status: 400 }),
      );

      const provider = new OpenAiProvider(buildConfig({ AI_MAX_RETRIES: '3' }));
      const error = await expectProviderError(provider.generate(request), {
        code: 'AI_INVALID_REQUEST',
        retryable: false,
      });

      expect(error.statusCode).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('classifies an unreachable endpoint as retryable and hides the transport message', async () => {
      fetchMock.mockRejectedValue(
        new TypeError(`fetch failed for ${ENDPOINT} using ${API_KEY}`),
      );

      const provider = new OpenAiProvider(buildConfig());
      const error = await expectProviderError(provider.generate(request), {
        code: 'AI_PROVIDER_UNAVAILABLE',
        retryable: true,
      });

      expect(error.statusCode).toBeUndefined();
      expect(error.message).not.toContain(API_KEY);
    });

    it('reports AI_NOT_CONFIGURED when no API key is configured', async () => {
      const provider = new OpenAiProvider(buildConfig({ AI_API_KEY: undefined }));

      await expectProviderError(provider.generate(request), {
        code: 'AI_NOT_CONFIGURED',
        retryable: false,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('malformed provider responses', () => {
    it('rejects a body that is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

      const provider = new OpenAiProvider(buildConfig());
      await expectProviderError(provider.generate(request), {
        code: 'AI_MALFORMED_RESPONSE',
        retryable: false,
      });
    });

    it('rejects a completion without any choice', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));

      const provider = new OpenAiProvider(buildConfig());
      await expectProviderError(provider.generate(request), {
        code: 'AI_EMPTY_RESPONSE',
        retryable: false,
      });
    });

    it.each(['plain text', '[1,2,3]', 'null'])(
      'rejects non-object content %p',
      async (content) => {
        fetchMock.mockResolvedValue(jsonResponse(completion(content)));

        const provider = new OpenAiProvider(buildConfig());
        await expectProviderError(provider.generate(request), {
          code: 'AI_MALFORMED_RESPONSE',
          retryable: false,
        });
      },
    );
  });
});
