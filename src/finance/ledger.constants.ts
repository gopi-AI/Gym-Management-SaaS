import {
  CREDIT_NOTE_STATUS,
  INVOICE_STATUS,
  OUTSTANDING_INVOICE_STATUSES,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from './finance.constants';

/**
 * P3-01 Finance ledger read model — shared constants (`docs/phase3-scoping-plan.md` §1).
 *
 * §1 defines the read model as three objects. The plan's names carry an `MV_`
 * prefix because it recommended materialized views for the two reporting
 * objects; the delivered design uses **plain views for all three**, so the
 * prefix is `V_` instead. Only the prefix changes — the object names, the
 * columns they are derived from and the endpoints they serve are unchanged.
 *
 * Nothing in this module writes. Every view is derived from `FINANCE_INVOICES`
 * and `FINANCE_PAYMENTS`, which stay the single source of truth (Phase 1
 * deliberately kept `amount_paid` out of the schema), so a ledger figure can
 * never disagree with the tables it is computed from.
 *
 * The status list and the payment status used by the views are taken from
 * `finance.constants.ts` rather than re-typed in SQL, so the SQL cannot drift
 * from the state machines the write paths enforce. `ledger.constants.spec.ts`
 * pins that lockstep.
 */

/** The Phase 3 finance read-model views, created by migration 1788965263253. */
export const FINANCE_LEDGER_VIEWS = {
  /** Per (`organization_id`, `member_id`): the member's outstanding balance. */
  MEMBER_OUTSTANDING: 'V_FINANCE_MEMBER_OUTSTANDING',
  /** Per (`organization_id`, `branch_id`, day): revenue taken from succeeded payments. */
  REVENUE_BY_PERIOD: 'V_FINANCE_REVENUE_BY_PERIOD',
  /** Per (`organization_id`, `status`, ageing bucket): outstanding invoice totals. */
  OUTSTANDING_BY_STATUS: 'V_FINANCE_OUTSTANDING_BY_STATUS',
} as const;

export type FinanceLedgerView = (typeof FINANCE_LEDGER_VIEWS)[keyof typeof FINANCE_LEDGER_VIEWS];

/**
 * Ageing bucket of an outstanding invoice, by whole days past its due date.
 *
 * The buckets are a fixed policy decision (approved for P3-01), not a
 * configurable one: they are hard-coded here and generated into the view SQL
 * from this same table, so the API label and the SQL grouping can never
 * disagree. `current` also covers a negative day count (an invoice whose due
 * date has not arrived).
 */
export type AgeingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface AgeingBucketDefinition {
  bucket: AgeingBucket;
  /** Inclusive lower bound in days overdue. */
  minDaysOverdue: number;
  /** Inclusive upper bound in days overdue; `null` means unbounded (the open bucket). */
  maxDaysOverdue: number | null;
}

/** Buckets in severity order. The LAST entry is the only unbounded one. */
export const AGEING_BUCKETS: readonly AgeingBucketDefinition[] = Object.freeze([
  { bucket: 'current', minDaysOverdue: Number.NEGATIVE_INFINITY, maxDaysOverdue: 0 },
  { bucket: '1-30', minDaysOverdue: 1, maxDaysOverdue: 30 },
  { bucket: '31-60', minDaysOverdue: 31, maxDaysOverdue: 60 },
  { bucket: '61-90', minDaysOverdue: 61, maxDaysOverdue: 90 },
  { bucket: '90+', minDaysOverdue: 91, maxDaysOverdue: null },
]);

/** Bucket labels in severity order (current → 90+). */
export const AGEING_BUCKET_ORDER: readonly AgeingBucket[] = AGEING_BUCKETS.map(
  (definition) => definition.bucket,
);

/** Label of the bucket a given whole-day overdue count falls into. */
export function ageingBucket(daysOverdue: number): AgeingBucket {
  const days = Number.isFinite(daysOverdue) ? Math.floor(daysOverdue) : 0;
  const match = AGEING_BUCKETS.find(
    (definition) =>
      days >= definition.minDaysOverdue &&
      (definition.maxDaysOverdue === null || days <= definition.maxDaysOverdue),
  );
  return match ? match.bucket : AGEING_BUCKET_ORDER[AGEING_BUCKET_ORDER.length - 1];
}

/** Severity index of a bucket, for ordering results. Unknown labels sort last. */
export function ageingBucketIndex(bucket: string): number {
  const index = AGEING_BUCKET_ORDER.indexOf(bucket as AgeingBucket);
  return index === -1 ? AGEING_BUCKET_ORDER.length : index;
}


/**
 * Revenue reporting granularity accepted by
 * `GET /v1/financial-reports/revenue-summary`.
 *
 * `V_FINANCE_REVENUE_BY_PERIOD` stores one row per day; the service rolls those
 * rows up to the requested granularity.
 */
export const REPORT_PERIODS = ['day', 'week', 'month'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** Double-quote a SQL identifier (view names, in practice). */
export function sqlIdentifier(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** Quote a SQL string literal. */
export function sqlStringLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Render a list of SQL string literals (`'a', 'b'`). */
export function sqlStringList(values: readonly string[]): string {
  return values.map((value) => sqlStringLiteral(value)).join(', ');
}

/**
 * Single-line `CASE` expression that maps a SQL "days overdue" expression to a
 * bucket label, generated from {@link AGEING_BUCKETS}.
 *
 * Generation (rather than a hand-written CASE in the migration) is what keeps
 * the hard-coded policy in exactly one place.
 */
export function sqlAgeingBucketCase(daysOverdueSql: string): string {
  const bounded = AGEING_BUCKETS.filter((definition) => definition.maxDaysOverdue !== null);
  const open = AGEING_BUCKETS[AGEING_BUCKETS.length - 1];

  const branches = bounded.map(
    (definition) =>
      `WHEN (${daysOverdueSql}) <= ${definition.maxDaysOverdue} THEN ${sqlStringLiteral(
        definition.bucket,
      )}`,
  );

  return `CASE ${branches.join(' ')} ELSE ${sqlStringLiteral(open.bucket)} END`;
}

/**
 * Whole days an invoice is past its due date, never negative (SQL fragment over
 * the `i` alias of `FINANCE_INVOICES`).
 *
 * Compared as dates, so "days overdue" is a calendar-day count that does not
 * shift with the time of day the report is requested.
 */
export const SQL_DAYS_OVERDUE = 'GREATEST((CURRENT_DATE - i."due_date"::date), 0)';

/** Invoice statuses that still represent money owed, as a SQL literal list. */
export const SQL_OUTSTANDING_STATUSES = sqlStringList(OUTSTANDING_INVOICE_STATUSES);

/** The only payment status that counts as money received, as a SQL literal. */
export const SQL_SUCCEEDED_PAYMENT = sqlStringLiteral(PAYMENT_STATUS.SUCCEEDED);

/**
 * The only credit-note status that reduces a balance, as a SQL literal (P3-02).
 *
 * A `voided` credit note is deliberately excluded: it no longer reduces the
 * invoice, so it must not reduce the ledger's outstanding figure either. The
 * views and `CreditNotesService.creditedTotal` must agree on this, exactly as
 * they agree on `SQL_SUCCEEDED_PAYMENT`, or the API and the ledger would report
 * different balances for the same invoice.
 */
export const SQL_ISSUED_CREDIT_NOTE = sqlStringLiteral(CREDIT_NOTE_STATUS.ISSUED);

/**
 * The only refund status that returned money, as a SQL literal (P3-02).
 *
 * A `failed` refund moved nothing, so netting it off revenue would understate
 * revenue. Matches `RefundsService.refundedTotal`, which counts only `succeeded`
 * refunds against a payment's refundable balance.
 */
export const SQL_SUCCEEDED_REFUND = sqlStringLiteral(REFUND_STATUS.SUCCEEDED);

/**
 * Order in which invoice statuses are presented in the outstanding-by-status
 * report — the same order as `OUTSTANDING_INVOICE_STATUSES`.
 */
export const OUTSTANDING_STATUS_ORDER: readonly string[] = OUTSTANDING_INVOICE_STATUSES;

/** Sort index of an invoice status within the outstanding report. */
export function outstandingStatusIndex(status: string): number {
  const index = OUTSTANDING_STATUS_ORDER.indexOf(status);
  return index === -1 ? OUTSTANDING_STATUS_ORDER.length : index;
}

/** Invoice statuses deliberately excluded from the outstanding views. */
export const SETTLED_INVOICE_STATUSES: readonly string[] = [
  INVOICE_STATUS.PAID,
  INVOICE_STATUS.VOID,
];
