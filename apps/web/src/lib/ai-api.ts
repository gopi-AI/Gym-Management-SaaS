/**
 * AI API endpoints.
 *
 * Mirrors the backend controller:
 *   - RetentionController  @Controller('v1/organizations')
 *
 * Only read-only, organization-scoped analysis endpoints live here. The tenant
 * is never sent in the request body: `orgId` is a route parameter and is
 * re-verified server-side against the authenticated principal.
 */

import { api } from './api';
import type {
  AiUsageResponse,
  PlanPerformanceRequest,
  PlanPerformanceResponse,
  RetentionAnalysisRequest,
  RetentionAnalysisResponse,
} from './types';

export const aiApi = {
  retentionAnalysis: (orgId: string, payload: RetentionAnalysisRequest = {}) =>
    api.post<RetentionAnalysisResponse>(
      `/v1/organizations/${orgId}/ai/retention-analysis`,
      payload,
    ),

  planPerformance: (orgId: string, payload: PlanPerformanceRequest = {}) =>
    api.post<PlanPerformanceResponse>(
      `/v1/organizations/${orgId}/ai/plan-performance`,
      payload,
    ),

  /**
   * Organization-scoped AI usage/cost summary for operators.
   *
   * Read-only and free: unlike the analysis endpoints this never triggers (or
   * bills) a provider call, so it is safe to fetch on render.
   */
  usage: (orgId: string) =>
    api.get<AiUsageResponse>(`/v1/organizations/${orgId}/ai/usage`),
};
