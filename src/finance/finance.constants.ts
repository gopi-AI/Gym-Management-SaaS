/**
 * Finance domain constants.
 *
 * Invoice states follow the Invoice state machine in `docs/domain-map.md`:
 *
 *   draft -> sent -> partially_paid -> paid
 *   draft | sent | partially_paid -> void
 *   paid -> [*] ; void -> [*]
 *
 * Payment states are the values carried by `FINANCE_PAYMENTS.status`:
 * pending -> succeeded | failed. A manual front-desk recording is created
 * directly as `succeeded`; gateway payments (Phase 3) enter as `pending` and are
 * driven forward by the payment retry worker.
 */

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  VOID: 'void',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

/** Invoice states that may legally receive a payment. */
export const PAYABLE_INVOICE_STATUSES: string[] = [
  INVOICE_STATUS.SENT,
  INVOICE_STATUS.PARTIALLY_PAID,
];

/**
 * Invoice states that still represent money owed by the member: everything
 * except `paid` and `void`.
 */
export const OUTSTANDING_INVOICE_STATUSES: string[] = [
  INVOICE_STATUS.DRAFT,
  INVOICE_STATUS.SENT,
  INVOICE_STATUS.PARTIALLY_PAID,
];

/** Legal invoice state transitions (docs/domain-map.md). */
export const VALID_INVOICE_TRANSITIONS: Record<string, string[]> = {
  [INVOICE_STATUS.DRAFT]: [INVOICE_STATUS.SENT, INVOICE_STATUS.VOID],
  [INVOICE_STATUS.SENT]: [INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID, INVOICE_STATUS.VOID],
  [INVOICE_STATUS.PARTIALLY_PAID]: [INVOICE_STATUS.PAID, INVOICE_STATUS.VOID],
  [INVOICE_STATUS.PAID]: [],
  [INVOICE_STATUS.VOID]: [],
};

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

/** Payment methods accepted for manual front-desk recording. */
export const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * P3-02 — refund states (`FINANCE_REFUNDS.status`).
 *
 * Mirrors `PAYMENT_STATUS` because a refund is the inverse of a payment and the
 * two are reported side by side. The lifecycle is `pending -> succeeded | failed`.
 *
 * In P3-02 every refund is written directly as `succeeded`: refunds are
 * staff-initiated and recorded manually (see §15 Q5), so there is no provider call
 * to wait on. `pending` exists in the value set — and in the schema — so P3-03 can
 * drive a gateway-initiated refund through the same column without a migration.
 */
export const REFUND_STATUS = {
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

/**
 * P3-02 — credit-note states (`FINANCE_CREDIT_NOTES.status`).
 *
 * Deliberately NOT the same value set as a refund. A credit note moves no money,
 * so there is nothing for a provider to accept or reject: it is `issued` the
 * moment it is written. `voided` exists so a mistaken credit note can be reversed
 * without deleting an audit record — finance records are append-only in this
 * codebase, and a deleted credit note would silently restore an invoice's balance.
 */
export const CREDIT_NOTE_STATUS = {
  ISSUED: 'issued',
  VOIDED: 'voided',
} as const;

export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUS)[keyof typeof CREDIT_NOTE_STATUS];

/** Credit-note states that still reduce an invoice balance. */
export const ACTIVE_CREDIT_NOTE_STATUSES: string[] = [CREDIT_NOTE_STATUS.ISSUED];

/** Current event version for finance events. Mirrors EVENT_VERSIONS.V1. */
export const FINANCE_EVENT_VERSION = 'v1';

/**
 * Finance event type names.
 *
 * Mirrors FINANCE_EVENT_TYPES in packages/contracts/src/events/finance.events.ts,
 * which in turn mirrors `docs/event-contracts.md` (§Finance Events). The backend
 * deliberately does not import the contracts package at build time (rootDir is
 * ./src), so the names are mirrored here and MUST stay in lockstep.
 */
export const FINANCE_EVENT_TYPES = {
  INVOICE_CREATED: 'InvoiceCreated',
  PAYMENT_SUCCEEDED: 'PaymentSucceeded',
  PAYMENT_FAILED: 'PaymentFailed',
  // P3-02. Unversioned, matching the finance convention above (the version is
  // carried separately by FINANCE_EVENT_VERSION). Both names were already
  // reserved in `docs/domain-map.md` line 96.
  REFUND_ISSUED: 'RefundIssued',
  CREDIT_NOTE_ISSUED: 'CreditNoteIssued',
  INVOICE_OVERDUE: 'InvoiceOverdue',
  DUNNING_ESCALATED: 'DunningEscalated',
} as const;

/** Human-readable message for each check-in / payment blocking state. */
export const INVOICE_STATUS_MESSAGES: Record<string, string> = {
  [INVOICE_STATUS.DRAFT]: 'Invoice is a draft; issue it before recording a payment',
  [INVOICE_STATUS.VOID]: 'Invoice has been voided',
  [INVOICE_STATUS.PAID]: 'Invoice has already been paid',
};

/** Default retry policy for the payment retry worker. */
export const PAYMENT_RETRY_DEFAULTS = {
  MAX_ATTEMPTS: 3,
  BATCH_SIZE: 50,
  /** Delay before the Nth retry: base * 2^N, capped. */
  BASE_DELAY_MS: 15 * 60 * 1000,
  MAX_DELAY_MS: 24 * 60 * 60 * 1000,
} as const;

/**
 * Normalise a numeric-ish value to a 2-decimal money string.
 *
 * Amounts are persisted as NUMERIC(15,2) and compared as numbers, so every
 * arithmetic result is rounded back to 2 decimals before it is stored.
 */
export function toMoney(value: number | string): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return '0.00';
  return (Math.round(parsed * 100) / 100).toFixed(2);
}

/** Currency-safe sum of a list of money values. */
export function sumMoney(values: Array<number | string>): string {
  return toMoney(values.reduce<number>((total, value) => total + Number(value || 0), 0));
}

/** Backoff delay (ms) before the given retry attempt (1-based). */
export function paymentRetryDelayMs(attempt: number): number {
  const delay = PAYMENT_RETRY_DEFAULTS.BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, PAYMENT_RETRY_DEFAULTS.MAX_DELAY_MS);
}

/* ------------------------------------------------------------------------ *
 * P3-04 Tax calculation
 *
 * `docs/phase3-scoping-plan.md` §4: "The arithmetic must be centralised in one
 * function in `finance.constants.ts` next to `toMoney()` / `sumMoney()`, because
 * those helpers already establish that all money arithmetic is rounded to 2
 * decimals in exactly one place." That is why the tax arithmetic lives here and
 * not in a new module.
 *
 * The three decisions this code encodes were ruled on before implementation:
 *
 *   - **Rates are per organization** (§15 Q6). One regime per tenant; no
 *     branch-level or per-item rate resolution.
 *   - **Exemption is a property of the member** (§15 Q7): `Member.tax_exempt`.
 *     An exempt member is charged no tax on any line, but the tax that WOULD have
 *     applied is still recorded as an audit row (§4: "a zero-rated line is a real
 *     audit row, not a missing one").
 *   - **`subtotal` is net of tax** (§15 Q9), so the existing
 *     `subtotal` / `tax_amount` / `total_amount` triple stays consistent for both
 *     tax-exclusive and tax-inclusive rates.
 *
 * Discounts are explicitly NOT part of this task (P3-04 is tax-only; first-class
 * discounting was split into P3-04b). The functions below take a line's amount as
 * given, so a future discount reduces `lineTotal` before tax is computed and no
 * arithmetic here has to change.
 * ------------------------------------------------------------------------ */

/**
 * Rate unit: `FINANCE_TAX_RATES.rate` is a PERCENTAGE, so `18.00` means 18%.
 *
 * Stored as a percentage rather than a fraction because that is how tax rates are
 * quoted, printed on invoices and configured by operators; a 0.18 fraction would
 * have to be converted at every read and is an easy place to lose a factor of 100.
 */
export const TAX_RATE_UNIT = 'percent';

/**
 * `tax_name` recorded on a zero-rated tax line for an exempt member.
 *
 * A constant rather than a literal at the call site because the value is
 * reportable: a tax report groups by `tax_name`, and "Tax exempt" must be one
 * label, not a set of near-duplicates invented per caller.
 */
export const TAX_EXEMPT_NAME = 'Tax exempt';

/** A line's amounts once tax has been resolved for it. All values are 2dp strings. */
export interface TaxedLineAmounts {
  /**
   * Portion of the line that belongs in `Invoice.subtotal` — net of tax. For an
   * exclusive rate this equals the line total; for an inclusive rate it is the
   * line total minus the tax already inside it.
   */
  netAmount: string;
  /** Tax on the line, rounded to 2 decimals. */
  taxAmount: string;
  /** Net + tax: what the member actually owes for this line. */
  grossAmount: string;
}

/** Input to {@link computeLineTax}. */
export interface TaxableLineInput {
  /** Gross line amount (quantity x unit_price) BEFORE tax is separated out. */
  lineTotal: number | string;
  /** Rate as a percentage, e.g. `18` for 18%. */
  ratePercent: number | string;
  /** `true` when `lineTotal` already contains the tax (a tax-inclusive regime). */
  isInclusive: boolean;
  /**
   * `true` when the member is tax-exempt. The rate is still passed through so the
   * caller can record what would have been applied.
   */
  isExempt?: boolean;
}

/**
 * Split a line's gross amount into its net and tax parts.
 *
 * Rounding is applied ONCE per part and `netAmount` is then DERIVED so that
 * `net + tax === gross` exactly, in both directions. Rounding net and tax
 * independently would let a line fail to add up to its own total (e.g. a 0.05 line
 * at 18% inclusive rounds to 0.04 + 0.01 = 0.05, but 0.04 + 0.02 = 0.06 is
 * reachable for other inputs), and an invoice whose lines do not sum to its total
 * is the single most visible tax bug there is.
 *
 * A zero, negative or unparseable rate is treated as "no tax" rather than as an
 * error: this is a pure arithmetic helper, and rejecting a malformed rate is the
 * caller's job (`TaxRatesService` refuses to hand out one at all).
 */
export function computeLineTax(input: TaxableLineInput): TaxedLineAmounts {
  const gross = toMoney(input.lineTotal);

  if (input.isExempt) {
    // No tax is charged, but the line is not silently dropped: the caller records
    // a zero-amount tax line so the exemption is auditable.
    return { netAmount: gross, taxAmount: toMoney(0), grossAmount: gross };
  }

  const rate = Number(input.ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { netAmount: gross, taxAmount: toMoney(0), grossAmount: gross };
  }

  const grossValue = Number(gross);

  // Exclusive: tax sits ON TOP of the line total.
  //   gross 100 @ 18%  ->  tax 18.00, net 100.00, total 118.00
  // Inclusive: tax is ALREADY INSIDE the line total, so it is the share of the
  // gross that the rate represents (gross * r / (100 + r)).
  //   gross 118 @ 18%  ->  tax 18.00, net 100.00, total 118.00
  const tax = input.isInclusive
    ? toMoney((grossValue * rate) / (100 + rate))
    : toMoney((grossValue * rate) / 100);

  const net = input.isInclusive ? toMoney(grossValue - Number(tax)) : gross;

  return { netAmount: net, taxAmount: tax, grossAmount: toMoney(Number(net) + Number(tax)) };
}

/**
 * Roll a set of taxed lines up into the invoice's three stored amounts.
 *
 * `taxAmount` is the sum of the PER-LINE tax values, never a recomputation from
 * the summed subtotal. That is what makes `Invoice.tax_amount` equal the sum of its
 * `FINANCE_TAX_LINES.tax_amount` rows to the cent — the property that lets a tax
 * authority's report reconcile against the invoice header, and the one most easily
 * lost by rounding the aggregate instead of the lines.
 */
export function computeInvoiceTotals(lines: TaxedLineAmounts[]): {
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
} {
  const subtotal = sumMoney(lines.map((line) => line.netAmount));
  const taxAmount = sumMoney(lines.map((line) => line.taxAmount));
  return { subtotal, taxAmount, totalAmount: sumMoney([subtotal, taxAmount]) };
}
