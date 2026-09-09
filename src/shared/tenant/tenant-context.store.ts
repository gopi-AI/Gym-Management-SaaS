import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request tenant context.
 *
 * Stored in an AsyncLocalStorage instance so each request's async chain has an
 * isolated store. This is essential: a singleton mutable property (or a global
 * Redis key) would leak one request's tenant into another concurrent request.
 *
 * - authenticatedUserId      : from the verified JWT (never client-supplied)
 * - requestedOrganizationId  : org ID requested via route/header/query/body —
 *                              NEVER trusted as proof of authorization; must be
 *                              validated against an active membership
 * - organizationId / branchId: established context AFTER membership/branch
 *                              ownership validation succeeds
 */
export interface RequestTenantContext {
  userId?: string;
  requestedOrganizationId?: string;
  organizationId?: string;
  branchId?: string;
}

export const tenantAsyncLocal = new AsyncLocalStorage<RequestTenantContext>();