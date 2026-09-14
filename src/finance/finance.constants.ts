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
