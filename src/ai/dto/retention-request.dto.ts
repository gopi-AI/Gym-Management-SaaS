import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  AI_ANALYSIS_PERIODS,
  AiAnalysisWindow,
} from '../config/ai-analysis-window';

/** Supported analysis windows. Bounded by design (no arbitrary date ranges). */
export const RETENTION_PERIODS = AI_ANALYSIS_PERIODS;
export type RetentionPeriod = (typeof RETENTION_PERIODS)[number];

/**
 * Request body for the retention-analysis endpoint.
 *
 * There is deliberately NO `organization_id` field: the tenant is always
 * derived from the authenticated principal, never from client input.
 */
export class RetentionAnalysisRequestDto {
  @IsOptional()
  @IsUUID('4')
  branch_id?: string;

  @IsOptional()
  @IsIn(RETENTION_PERIODS as unknown as string[])
  period?: RetentionPeriod;
}

/** Period descriptor embedded in the prompt payload. */
export type RetentionPeriodInfo = AiAnalysisWindow<RetentionPeriod>;

/** Non-sensitive tenant metadata embedded in the prompt payload. */
export interface RetentionTenantContext {
  organization_id: string;
  time_zone: string | null;
  locale: string | null;
  currency: string | null;
  branch_id: string | null;
  branch_name: string | null;
}

/** Minimal member projection sent to the provider. Contains no PII beyond the display name. */
export interface RetentionPromptMember {
  member_id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  plan_name: string | null;
  branch_name: string | null;
}

/**
 * Server-built prompt payload.
 *
 * Assembled exclusively from organization-scoped database rows (see
 * `RetentionService`) — never from client-supplied collections.
 */
export interface RetentionAnalysisRequestPayload {
  period: RetentionPeriodInfo;
  tenant: RetentionTenantContext;
  memberships: RetentionPromptMember[];
}
