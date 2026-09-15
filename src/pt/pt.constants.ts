/**
 * PT module constants (Phase 2, Module 4 of 8).
 *
 * Event names mirror the §1 event-contract table verbatim. The money helpers are
 * deliberately local: `finance.constants.toMoney` is finance-internal and is not
 * exported across domain boundaries, so PT keeps its own 2-decimal rounding
 * rather than coupling the PT domain to the finance module.
 */

/** Contract version for every PT event (§1 event contracts). */
export const PT_EVENT_VERSION = '1';

/** Event types published by this module (§1 event contracts). */
export const PT_EVENT_TYPES = {
  ENROLLMENT_CREATED: 'PTEnrollmentCreated.v1',
  SESSION_BOOKED: 'PTSessionBooked.v1',
  SESSION_COMPLETED: 'PTSessionCompleted.v1',
  SESSION_CANCELLED: 'PTSessionCancelled.v1',
  TRAINER_COMMISSION_EARNED: 'TrainerCommissionEarned.v1',
} as const;

/**
 * Normalise a numeric-ish value to a 2-decimal money string.
 *
 * `price`, `amount` and `currency` values are persisted as NUMERIC columns and
 * read back as strings, so every derived money value is rounded to 2 decimals
 * before it is stored (same convention as the finance module).
 */
export function toMoney(value: number | string): string {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return '0.00';
  return (Math.round(parsed * 100) / 100).toFixed(2);
}

/**
 * Trainer commission at enrollment time (§12 Q2) — the literal contract formula:
 *
 *   amount = package.price × commission_percent / 100
 *
 * A missing/`null` commission percent resolves to `0.00` (see the
 * `PTPackage.commission_percent` / `PTEnrollment.commission_percent` docs for the
 * rationale). Computed ONCE, at enrollment creation — never per session and
 * never recalculated afterwards.
 */
export function computeCommissionAmount(
  price: number | string,
  commissionPercent: number | string | null | undefined,
): string {
  const percent = Number(commissionPercent ?? 0);
  if (!Number.isFinite(percent)) return '0.00';
  return toMoney((Number(price) * percent) / 100);
}
