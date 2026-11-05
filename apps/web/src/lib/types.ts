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

/* ── Member 360 (P2-09) ────────────────────────────────────────────────── */

/**
 * Response of `GET /v1/members/:memberId/360/header` (P2-01).
 *
 * camelCase on the wire — the backend DTO is a plain interface, not an entity.
 * `photo` is always null in Phase 2: the member table has no photo column.
 */
export interface Member360HeaderResponse {
  member: {
    id: string;
    localId: number;
    firstName: string;
    lastName: string;
    photo?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  membership: {
    status: string | null;
    planId: string | null;
    endDate: string | null;
    daysRemaining: number | null;
  } | null;
  accessStatus: {
    /** `denied` is part of the contract but is not produced by the read path. */
    today: 'granted' | 'denied' | 'not_checked_in';
    lastCheckIn: string | null;
  };
  currentMeasurements: {
    weight: string | null;
    bodyFat: string | null;
    height: string | null;
  };
  /** Machine-readable codes, e.g. `check_in`, `renew`, `book_pt`, `log_workout`, `log_meal`. */
  quickActions: string[];
  activePtEnrollmentCount: number;
  hasRemainingPtSessions: boolean;
}

/* ── Personal training tab (P2-04) ─────────────────────────────────────── */

export interface PtEnrollment {
  id: string;
  organization_id: string;
  member_id: string;
  package_id: string;
  /** Bare id — the response carries no hydrated trainer identity. */
  trainer_id: string;
  commission_percent?: string | null;
  start_date: string;
  end_date?: string | null;
  sessions_used: number;
  session_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * NOTE: the entity's `sessions_remaining` getter is NOT part of the HTTP
 * response — it lives on the prototype, so JSON serialisation drops it.
 * Derive it as `session_count - sessions_used`.
 */
export interface PtSession {
  id: string;
  organization_id: string;
  branch_id: string;
  member_id: string;
  trainer_id: string;
  enrollment_id: string;
  scheduled_start: string;
  scheduled_end: string;
  actual_start?: string | null;
  actual_end?: string | null;
  /** scheduled | completed | cancelled | no_show */
  status: string;
  notes?: string | null;
  workout_session_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutsTabResponse {
  assignments: WorkoutsTabAssignment[];
  /** Newest first; soft-deleted sessions are excluded by the API. */
  sessions: WorkoutSession[];
  exercises: Exercise[];
}

export interface WorkoutExerciseCompletion {
  completed: number;
  prescribed: number;
  percentage: number;
}

export interface WorkoutPlanDayStatusCounts {
  pending: number;
  submitted: number;
  remaining_required: number;
  approved: number;
}

export interface WorkoutAssignmentProgress {
  /** Trainer-approved finished prescribed days. */
  completed: number;
  /** Non-rest prescribed days. */
  prescribed: number;
  /** 0–100, server-computed and capped. */
  percentage: number;
  status_counts?: WorkoutPlanDayStatusCounts;
  /** Supporting metric only; never the primary plan-completion measure. */
  exercise_completion?: WorkoutExerciseCompletion;
}

export interface WorkoutsTabAssignment extends WorkoutPlanAssignment {
  progress: WorkoutAssignmentProgress;
}

export interface WorkoutSessionExercise {
  id: string;
  session_id: string;
  exercise_id: string;
  /** The assignment snapshot row this log fulfils. */
  prescribed_day_exercise_id?: string | null;
  /** Regular-member checkbox. */
  completed?: boolean | null;
  sets_completed?: number | null;
  reps_completed?: number | null;
  /** NUMERIC columns are returned by pg as strings. */
  weight_used?: string | number | null;
  rpe?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface WorkoutSession {
  id: string;
  organization_id: string;
  member_id: string;
  template_id?: string | null;
  assignment_id?: string | null;
  prescribed_day_id?: string | null;
  /** in_progress | finished | cancelled */
  status: 'in_progress' | 'finished' | 'cancelled';
  /** ISO date (YYYY-MM-DD). */
  session_date: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  mood?: number | null;
  created_by?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  session_exercises?: WorkoutSessionExercise[];
  created_at: string;
  updated_at?: string;
}

export interface WorkoutPlanAssignment {
  id: string;
  organization_id: string;
  member_id: string;
  /** Legacy flat-template source (nullable for plan-template assignments). */
  template_id?: string | null;
  plan_template_id?: string | null;
  logging_mode?: 'simple' | 'detailed';
  snapshot_taken_at?: string | null;
  progress_review_id?: string | null;
  assigned_by: string;
  assigned_at: string;
  start_date: string;
  end_date?: string | null;
  /** active | completed | expired */
  status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Exercise {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  muscle_group?: string | null;
  equipment_needed?: string | null;
  image_key?: string | null;
  image_mime_type?: string | null;
  gif_key?: string | null;
  gif_mime_type?: string | null;
  video_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/* ── P2-05 workout composition / assignment / review shapes ───────────── */

export type PlanDayStatus =
  | 'pending'
  | 'submitted'
  | 'remaining_required'
  | 'approved';

export type ExerciseSection =
  | 'warmup'
  | 'strength'
  | 'cardio'
  | 'stretch'
  | 'recovery';

export interface WorkoutDayTemplateExercise {
  id: string;
  day_template_id: string;
  exercise_id: string;
  section: ExerciseSection;
  sets?: number | null;
  reps?: number | null;
  weight_template?: string | number | null;
  rest_seconds?: number | null;
  duration_seconds?: number | null;
  distance_meters?: string | number | null;
  instructions?: string | null;
  sort_order: number;
  exercise_name?: string | null;
}

export interface WorkoutDayTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  estimated_duration_minutes?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  exercises?: WorkoutDayTemplateExercise[];
}

export interface WorkoutPlanTemplateDay {
  id: string;
  plan_template_id: string;
  day_template_id?: string | null;
  day_order: number;
  day_label?: string | null;
  is_rest_day: boolean;
  is_optional: boolean;
  day_template?: { id: string; name: string } | null;
  created_at: string;
}

export interface WorkoutPlanTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  days?: WorkoutPlanTemplateDay[];
}

export interface PrescribedWorkoutDayExercise {
  id: string;
  prescribed_day_id: string;
  exercise_id: string;
  section: ExerciseSection;
  sets?: number | null;
  reps?: number | null;
  weight_template?: string | number | null;
  rest_seconds?: number | null;
  duration_seconds?: number | null;
  distance_meters?: string | number | null;
  instructions?: string | null;
  sort_order: number;
  exercise_name_snapshot: string;
}

export interface PrescribedWorkoutDay {
  id: string;
  organization_id: string;
  assignment_id: string;
  sequence_order: number;
  source_day_template_id?: string | null;
  name: string;
  day_label?: string | null;
  is_rest_day: boolean;
  is_optional: boolean;
  status: PlanDayStatus;
  submitted_at?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
  exercises?: PrescribedWorkoutDayExercise[];
}

export interface WorkoutSequenceEntry {
  assignment: WorkoutPlanAssignment;
  days: PrescribedWorkoutDay[];
  current_day_id: string | null;
  progress: WorkoutAssignmentProgress;
}

export interface PlanDaySubmissionExercise {
  id: string;
  submission_id: string;
  prescribed_day_exercise_id: string;
  completed?: boolean | null;
  sets_completed?: number | null;
  reps_completed?: number | null;
  weight_used?: string | number | null;
  notes?: string | null;
}

export interface PlanDaySubmission {
  id: string;
  organization_id: string;
  prescribed_day_id: string;
  member_id: string;
  submitted_by?: string | null;
  submitted_at: string;
  notes?: string | null;
  exercises: PlanDaySubmissionExercise[];
}

export interface PlanDayReview {
  id: string;
  organization_id: string;
  prescribed_day_id: string;
  submission_id?: string | null;
  reviewed_by?: string | null;
  decision: 'approve' | 'request_remaining';
  notes?: string | null;
  decided_at: string;
  created_at: string;
}

export interface PrescribedDayDetail {
  day: PrescribedWorkoutDay & { exercises: PrescribedWorkoutDayExercise[] };
  assignment: WorkoutPlanAssignment;
  submissions: PlanDaySubmission[];
  reviews: PlanDayReview[];
  sessions: WorkoutSession[];
}

export interface ProgressReviewMeasurement {
  id: string;
  review_id: string;
  measurement_id: string;
  measurement_type: string;
  value: string | number;
  unit: string;
  measured_at: string;
}

export interface WorkoutProgressReview {
  id: string;
  organization_id: string;
  member_id: string;
  assignment_id: string;
  review_date: string;
  period_start: string;
  period_end: string;
  approved_days: number;
  prescribed_days: number;
  progress_percentage: number;
  plan_day_summary: Record<string, number>;
  attendance_summary: Record<string, unknown>;
  results?: string | null;
  fitness_improvements?: string | null;
  goal_assessment?: string | null;
  observations?: string | null;
  recommendations?: string | null;
  decision: 'continue' | 'modify' | 'extend' | 'new_plan';
  reviewed_by?: string | null;
  resulting_assignment_id?: string | null;
  created_at: string;
  measurements: ProgressReviewMeasurement[];
}

export interface ProgressReviewComparison {
  member_id: string;
  reviews: Array<{
    id: string;
    review_date: string;
    period_start: string;
    period_end: string;
    approved_days: number;
    prescribed_days: number;
    progress_percentage: number;
    decision: string;
  }>;
  measurements: Array<{
    measurement_type: string;
    unit: string;
    points: Array<{
      review_id: string;
      review_date: string;
      measurement_id: string;
      value: number;
    }>;
  }>;
}

export interface MeasurementLog {
  id: string;
  organization_id: string;
  member_id: string;
  measurement_type: string;
  value: string | number;
  unit: string;
  measured_at: string;
  measured_by?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface AttendanceMemberHistoryPoint {
  date: string;
  checkInCount: number;
  firstCheckIn: string | null;
  lastCheckIn: string | null;
}

export interface CreateExerciseRequest {
  name: string;
  description?: string;
  category?: string;
  muscle_group?: string;
  equipment_needed?: string;
  is_active?: boolean;
}

export interface DayTemplateExerciseInput {
  exercise_id: string;
  section?: ExerciseSection;
  sets?: number;
  reps?: number;
  weight_template?: number;
  rest_seconds?: number;
  duration_seconds?: number;
  distance_meters?: number;
  instructions?: string;
  sort_order: number;
}

export interface PlanTemplateDayInput {
  day_template_id?: string;
  day_label?: string;
  is_rest_day?: boolean;
  is_optional?: boolean;
  day_order: number;
}

export interface CreateAssignmentRequest {
  plan_template_id: string;
  start_date: string;
  end_date?: string;
  notes?: string;
  logging_mode?: 'simple' | 'detailed';
}

export interface CreateProgressReviewRequest {
  assignment_id: string;
  review_date: string;
  period_start: string;
  period_end: string;
  decision: 'continue' | 'modify' | 'extend' | 'new_plan';
  results?: string;
  fitness_improvements?: string;
  goal_assessment?: string;
  observations?: string;
  recommendations?: string;
  measurement_ids?: string[];
  next_assignment?: CreateAssignmentRequest;
}

export interface PtWorkoutProgress {
  assignment: WorkoutPlanAssignment;
  progress: {
    completed: number;
    prescribed: number;
    /** 0–100, server-computed */
    percentage: number;
  };
}

export interface PtTabResponse {
  enrollments: PtEnrollment[];
  sessions: PtSession[];
  workoutProgress: PtWorkoutProgress[];
}

/* ── Diet tab (P2-06) ──────────────────────────────────────────────────── */

export interface DietPlanAssignment {
  id: string;
  organization_id: string;
  member_id: string;
  diet_plan_id: string;
  assigned_by: string;
  assigned_at: string;
  start_date: string;
  end_date?: string | null;
  /** active | completed | expired */
  status: string;
  created_at: string;
  updated_at: string;
}

/** One logged meal. Macro columns are null when no macro data was submitted. */
export interface NutritionLog {
  id: string;
  organization_id: string;
  member_id: string;
  assignment_id?: string | null;
  /** Set for a templated meal; null for a free-text one. */
  meal_template_id?: string | null;
  meal_description?: string | null;
  log_date: string;
  servings: number;
  logged_at: string;
  calories?: number | null;
  protein_g?: string | null;
  carbs_g?: string | null;
  fat_g?: string | null;
  created_at: string;
}

/**
 * One day of macro totals (the backend defaults the window to the last 30
 * days). Null totals mean no meal that day carried macro data; those meals are
 * counted in `mealsMissingMacros` and excluded from the sums.
 */
export interface DietDailyTotal {
  log_date: string;
  totalCalories: number | null;
  totalProteinG: number | null;
  totalCarbsG: number | null;
  totalFatG: number | null;
  mealsMissingMacros: number;
  totalMeals: number;
  /** Share of that day's meals with complete macros, 0–100. */
  adherencePct: number;
}

export interface DietTabResponse {
  dietPlans: DietPlanAssignment[];
  nutritionLogs: NutritionLog[];
  dailyTotals: DietDailyTotal[];
}

/* ── Loyalty tab (P2-08) ───────────────────────────────────────────────── */

export interface LoyaltyAccount {
  id: string;
  organization_id: string;
  member_id: string;
  balance: number;
  lifetime_points_earned: number;
  /** Always 0 in Phase 2 — redemption is deferred to Phase 3. */
  lifetime_points_redeemed: number;
  /** Null in Phase 2 — no tier system yet. */
  tier?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LoyaltyTransaction {
  id: string;
  account_id: string;
  /** earn | adjust | expire | redeem (`redeem` is not produced in Phase 2). */
  transaction_type: string;
  points: number;
  remaining_points: number;
  reference_type?: string | null;
  reference_id?: string | null;
  description?: string | null;
  expires_at?: string | null;
  created_at: string;
}

/** `account` is present whenever this response exists — a 404 means "no account". */
export interface LoyaltyTabResponse {
  account: LoyaltyAccount;
  transactions: LoyaltyTransaction[];
}
