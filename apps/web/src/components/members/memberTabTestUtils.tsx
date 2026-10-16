/**
 * Shared harness for the Member 360 tab component tests (P2-09).
 *
 * The five tabs (`MembershipsTab`, `PtTab`, `WorkoutsTab`, `DietTab`,
 * `LoyaltyTab`) are hook-driven presentational components: each calls its own
 * React Query hook with `{ enabled: active }` and then renders exactly one of
 * loading / error / empty / data. Testing a tab therefore means driving a real
 * `QueryClient` against a stubbed `fetch`, which is what this module wires up.
 *
 * Why the response stub is hand-rolled instead of `new Response(...)`:
 * `jest-environment-jsdom` gives us `window`, `localStorage`, `Headers` and
 * `FormData`, but NOT `fetch`, `Response` or `Request` (verified by running a
 * probe spec in this environment — `Response` and `fetch` are `undefined`).
 * `lib/api.ts` only ever reads `ok`, `status`, `headers.get`, `text()` and
 * `json()` off a response, so `MockResponse` implements exactly those five and
 * nothing more.
 *
 * Everything here is deliberately explicit — no `beforeEach` registered at
 * import time — so a reader of each spec file can see its own setup.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** The subset of the DOM `Response` contract that `lib/api.ts` actually reads. */
export interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** A response whose body is `body` serialised as JSON. */
export function jsonResponse(body: unknown, status = 200): MockResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/**
 * An error response shaped like this backend's exception filter body, so that
 * `parseError` in `lib/api.ts` surfaces `message` as the `ApiError` message.
 */
export function errorResponse(status: number, message: string): MockResponse {
  return jsonResponse({ statusCode: status, message }, status);
}

/** A response that never settles — pins a query in its loading state. */
export function pendingResponse(): Promise<never> {
  return new Promise<never>(() => {
    /* Never resolves: the query stays pending for the whole test. */
  });
}

const globalWithFetch = globalThis as { fetch?: unknown };
let originalFetch: unknown;
let originalCaptured = false;

/**
 * Installs a fresh `jest.Mock` as `globalThis.fetch` and returns it.
 *
 * jsdom provides no `fetch`, so there is normally nothing to save; the original
 * is captured anyway so this stays correct if the environment ever gains one.
 */
export function installFetchMock(): jest.Mock {
  if (!originalCaptured) {
    originalFetch = globalWithFetch.fetch;
    originalCaptured = true;
  }
  const mock = jest.fn();
  globalWithFetch.fetch = mock;
  return mock;
}

/** Restores `globalThis.fetch` to the value it had before the mock. */
export function restoreFetchMock(): void {
  if (originalFetch === undefined) {
    delete globalWithFetch.fetch;
  } else {
    globalWithFetch.fetch = originalFetch;
  }
}

/**
 * A `QueryClient` for one test.
 *
 * `retry: false` is load-bearing: React Query retries a failed query three
 * times by default, which would make every error-state assertion wait on
 * exponential backoff.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

/**
 * The provider tree a tab is rendered inside.
 *
 * Exported as a component (rather than a bare `render` helper) because the
 * lazy-fetch gate test must `rerender` the *same* component with a different
 * `active` prop against the *same* client — RTL's `rerender` replaces the whole
 * tree, so the provider has to be part of it.
 */
export function TabHarness({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
