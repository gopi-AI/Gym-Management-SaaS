/**
 * Shared client-side types for the Gym Management API.
 *
 * These mirror the response shapes of the NestJS backend. Assertions in this
 * file are intentionally limited to field names the API actually returns.
 */

/* ── Auth ──────────────────────────────────────────────────────────────── */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  mfaRequired?: boolean;
  challenge?: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  is_active?: boolean;
  email_verified?: boolean;
  is_mfa_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface VerifyMfaRequest {
  challengeToken: string;
  otpCode: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/* ── Members ───────────────────────────────────────────────────────────── */

export interface Member {
  id: string;
  organization_id: string;
  branch_id: string;
  global_uuid: string;
  local_id: number;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  preferred_name?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface CreateMemberRequest {
  first_name: string;
  last_name: string;
  middle_name?: string;
  preferred_name?: string;
  date_of_birth?: string;
  gender?: string;
  phone?: string;
  email?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  branch_id?: string;
}

export type UpdateMemberRequest = Partial<CreateMemberRequest>;

export interface ListMembersParams {
  page?: number;
  limit?: number;
  search?: string;
  branch_id?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/* ── Organizations / branches / settings ───────────────────────────────── */

export interface Organization {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface CreateOrganizationRequest {
  name: string;
  timezone?: string;
  locale?: string;
  currency?: string;
}

export type UpdateOrganizationRequest = Partial<CreateOrganizationRequest>;

export interface Branch {
  id: string;
  organization_id: string;
  name: string;
  address: string;
  phone: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface CreateBranchRequest {
  name: string;
  address?: string;
  phone?: string;
}

export type UpdateBranchRequest = Partial<CreateBranchRequest>;

export interface TenantSettings {
  id: string;
  organization_id: string;
  time_zone: string;
  locale: string;
  currency: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface UpdateTenantSettingsRequest {
  time_zone?: string;
  locale?: string;
  currency?: string;
}

/* ── Membership Plans ─────────────────────────────────────────────────── */

export interface MembershipPlan {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  price: string;
  currency: string;
  billing_period: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
  benefits?: Record<string, unknown>[] | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CreateMembershipPlanRequest {
  name: string;
  description?: string;
  price: string;
  currency: string;
  billing_period: string;
  duration_days: number;
  trial_days?: number;
  benefits?: Record<string, unknown>[];
}

export type UpdateMembershipPlanRequest = Partial<CreateMembershipPlanRequest> & {
  is_active?: boolean;
};

export interface QueryMembershipPlanParams {
  page?: number;
  limit?: number;
  is_active?: boolean;
}

/* ── Memberships ──────────────────────────────────────────────────────── */

export interface Membership {
  id: string;
  organization_id: string;
  member_id: string;
  plan_id?: string | null;
  branch_id?: string | null;
  status: string;
  start_date: string;
  end_date?: string | null;
  renewal_date?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  paused_at?: string | null;
  pause_end_at?: string | null;
  frozen_at?: string | null;
  price_at_signup?: string | null;
  currency_at_signup?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMembershipRequest {
  member_id: string;
  plan_id: string;
  branch_id?: string;
  start_date?: string;
  end_date?: string;
}

export type UpdateMembershipRequest = Partial<{
  plan_id: string;
  branch_id: string;
  start_date: string;
  end_date: string;
}>;

export interface QueryMembershipParams {
  page?: number;
  limit?: number;
  status?: string;
  plan_id?: string;
  branch_id?: string;
  member_id?: string;
}

export interface LifecycleActionRequest {
  reason?: string;
}

/* ── AI: Retention analysis ───────────────────────────────────────────── */

/** Analysis windows accepted by the backend (`RETENTION_PERIODS`). */
export const RETENTION_PERIODS = ['30d', '90d', '1y'] as const;
export type RetentionPeriod = (typeof RETENTION_PERIODS)[number];

/**
 * Request body for the retention-analysis endpoint.
 *
 * There is deliberately no tenant field: the organization is taken from the
 * route (and re-derived server-side from the authenticated principal).
 */
export interface RetentionAnalysisRequest {
  /** Optional branch scope. Omit to analyse the whole organization. */
  branch_id?: string;
  period?: RetentionPeriod;
}

export interface RetentionAtRiskMember {
  member_id: string;
  name: string;
  /** Model risk score in [0, 1] (higher = more likely to churn). */
  risk_score: number;
  risk_factors: string[];
  recommended_action: string;
}

export interface RetentionAnalysisResponse {
  organization_id: string;
  /** Predicted retention rate for the window, in [0, 1]. */
  retention_rate: number;
  total_members: number;
  at_risk_count: number;
  at_risk_members: RetentionAtRiskMember[];
  summary: string;
  /** ISO-8601 timestamp stamped by the server (never by the model). */
  generated_at: string;
}

/* ── AI: membership plan performance ─────────────────────────────────────── */

/** Analysis windows accepted by the backend (`PLAN_PERFORMANCE_PERIODS`). */
export const PLAN_PERFORMANCE_PERIODS = ['30d', '90d', '1y'] as const;
export type PlanPerformancePeriod = (typeof PLAN_PERFORMANCE_PERIODS)[number];

/**
 * Request body for the plan-performance endpoint.
 *
 * There is deliberately no tenant field: the organization is taken from the
 * route (and re-derived server-side from the authenticated principal).
 */
export interface PlanPerformanceRequest {
  /** Optional branch scope. Omit to analyse the whole organization. */
  branch_id?: string;
  period?: PlanPerformancePeriod;
}

export interface PlanPerformanceLifecycleTransition {
  transition: string;
  count: number;
}

/** Server-computed performance metrics for one plan. */
export interface PlanPerformancePlan {
  plan_id: string;
  name: string;
  price: number;
  currency: string;
  billing_period: string;
  duration_days: number;
  trial_days: number;
  is_active: boolean;
  total_memberships: number;
  active_memberships: number;
  paused_or_frozen_memberships: number;
  cancelled_memberships: number;
  /** cancelled / total memberships for this plan, in [0, 1]. */
  churn_rate: number;
  average_realized_days: number | null;
  discounted_signups: number;
  price_change_percent: number | null;
  lifecycle_transitions: PlanPerformanceLifecycleTransition[];
}

export type PlanPerformancePriority = 'high' | 'medium' | 'low';

export interface PlanPerformanceRecommendation {
  plan_id: string;
  /** Always supplied by the server, never by the model. */
  name: string;
  priority: PlanPerformancePriority;
  issue: string;
  recommended_action: string;
}

export interface PlanPerformanceResponse {
  organization_id: string;
  period: string;
  total_plans: number;
  analyzed_plans: number;
  total_memberships: number;
  active_memberships: number;
  /** Overall cancelled / total memberships, in [0, 1] (server-computed). */
  overall_churn_rate: number;
  /** Model assessment of portfolio health, in [0, 1]. */
  portfolio_health: number;
  plans: PlanPerformancePlan[];
  recommendations: PlanPerformanceRecommendation[];
  summary: string;
  /** ISO-8601 timestamp stamped by the server (never by the model). */
  generated_at: string;
}

/* ── AI: operator usage / cost visibility ─────────────────────────────── */

/** Aggregates for one UTC window (calendar day or calendar month). */
export interface AiUsageWindow {
  /** `YYYY-MM-DD` (day) or `YYYY-MM` (month), UTC. */
  label: string;
  requests: number;
  failed_requests: number;
  total_tokens: number;
  /** Server-computed from the AI_USAGE ledger; 0 when the model is unpriced. */
  estimated_cost_usd: number;
}

/** The limits the backend actually enforces (0 = disabled). */
export interface AiUsageLimits {
  rate_limit_requests_per_minute: number;
  rate_limit_window_seconds: number;
  daily_token_limit: number;
  monthly_cost_limit_usd: number;
}

/** Per-use-case breakdown for the current UTC month. */
export interface AiUsageRequestType {
  request_type: string;
  requests: number;
  failed_requests: number;
  total_tokens: number;
  estimated_cost_usd: number;
}
/* ── Attendance (front-desk check-in / check-out) ──────────────────────── */

/** Raw attendance event recorded by a check-in or check-out. */
export interface AttendanceEventRecord {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  /** Turnstile/reader id; null for a manual front-desk event. */
  device_id?: string | null;
  member_id: string;
  event_time: string;
  /** CHECK_IN | CHECK_OUT */
  event_type: string;
  biometric_id?: string | null;
}

/** One check-in/check-out session. `check_out_time === null` means "still in". */
export interface AttendanceRecord {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  member_id: string;
  check_in_time: string;
  check_out_time?: string | null;
  check_in_method: string;
  check_out_method?: string | null;
  /** Staff user that performed a manual check-in. */
  checked_in_by?: string | null;
}

/** The authorization outcome of an attendance event (audit trail). */
export interface AttendanceAccessDecision {
  id: string;
  attendance_event_id: string;
  is_granted: boolean;
  /** Denial reason; null when access was granted. */
  reason?: string | null;
  decided_at: string;
}

/** Response of a granted `POST /v1/attendance/events` or `/check-out`. */
export interface AttendanceEventResult {
  event: AttendanceEventRecord;
  decision: AttendanceAccessDecision;
  record: AttendanceRecord;
}

/** Body of `POST /v1/attendance/events` (check-in) and `/check-out`. */
export interface AttendanceEventRequest {
  member_id: string;
  branch_id?: string;
}

export interface QueryAttendanceRecordsParams {
  page?: number;
  limit?: number;
  member_id?: string;
  branch_id?: string;
  from?: string;
  to?: string;
  check_in_method?: string;
  /** Only members who are currently inside. */
  open_only?: boolean;
}

export interface QueryAccessDecisionParams {
  page?: number;
  limit?: number;
  member_id?: string;
  branch_id?: string;
  from?: string;
  to?: string;
  is_granted?: boolean;
}

/**
 * Body of the 403 returned when a check-in is refused. The reason code lets the
 * desk explain the refusal ("membership paused") and is machine-readable.
 */
export interface CheckInDeniedDetails {
  message: string;
  reason: string;
  attendance_event_id: string;
  access_decision_id: string;
}

/* ── Finance (invoices + payments) ─────────────────────────────────────── */

/** draft | sent | partially_paid | paid | void */
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'void';

/** pending | succeeded | failed */
export type PaymentStatus = 'pending' | 'succeeded' | 'failed';

/** cash | card | bank_transfer | other */
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';

export interface Invoice {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  member_id: string;
  membership_id?: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  status: InvoiceStatus;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  organization_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  tax_code?: string | null;
}

/** `amount_paid` / `outstanding_amount` are DERIVED from succeeded payments. */
export interface InvoiceListItem extends Invoice {
  amount_paid: string;
  outstanding_amount: string;
}

/** Response of `GET /v1/invoices/:id`. */
export interface InvoiceDetail {
  invoice: Invoice;
  items: InvoiceLineItem[];
  amount_paid: string;
  outstanding_amount: string;
}

export interface Payment {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  member_id: string;
  invoice_id: string;
  payment_method: PaymentMethod;
  transaction_id?: string | null;
  amount: string;
  payment_date: string;
  status: PaymentStatus;
  idempotency_key: string;
  created_at: string;
}

export interface CreateInvoiceLineItemRequest {
  description: string;
  quantity: number;
  unit_price: number;
  tax_code?: string;
}

export interface CreateInvoiceRequest {
  member_id: string;
  branch_id?: string;
  membership_id?: string;
  due_date?: string;
  /** Defaults to true (issued and payable); false holds the invoice as a draft. */
  issue?: boolean;
  line_items: CreateInvoiceLineItemRequest[];
}

export interface RecordPaymentRequest {
  amount: number;
  payment_method: PaymentMethod;
  transaction_id?: string;
  payment_date?: string;
  /** Replaying the same key returns the first payment instead of charging twice. */
  idempotency_key?: string;
}

export interface QueryInvoiceParams {
  page?: number;
  limit?: number;
  status?: InvoiceStatus | '';
  member_id?: string;
  membership_id?: string;
  branch_id?: string;
  from?: string;
  to?: string;
  /** Only invoices that still represent money owed. */
  outstanding_only?: boolean;
}

export interface QueryPaymentParams {
  page?: number;
  limit?: number;
  invoice_id?: string;
  member_id?: string;
  branch_id?: string;
  status?: PaymentStatus | '';
}


/** Budget consumption; `*_remaining` is null when the limit is disabled. */
export interface AiUsageQuota {
  tokens_used_today: number;
  token_limit_per_day: number;
  tokens_remaining_today: number | null;
  cost_used_this_month_usd: number;
  cost_limit_per_month_usd: number;
  cost_remaining_this_month_usd: number | null;
}

/**
 * Response of `GET /v1/organizations/:orgId/ai/usage`.
 *
 * Organization-scoped AGGREGATES only: no prompt, response, key, user or member
 * identity is ever returned by this endpoint.
 */
export interface AiUsageResponse {
  organization_id: string;
  /** ISO-8601 timestamp stamped by the server. */
  generated_at: string;
  /** Backend AI kill-switch (`AI_ENABLED`) as seen by the API process. */
  ai_enabled: boolean;
  day: AiUsageWindow;
  month: AiUsageWindow;
  quota: AiUsageQuota;
  limits: AiUsageLimits;
  by_request_type: AiUsageRequestType[];
}
