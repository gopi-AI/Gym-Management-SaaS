import { EventEnvelope } from './event-envelope';

/**
 * Loyalty domain events.
 *
 * This is the first contracts file for the loyalty domain. Before it existed the
 * event names lived only in `src/loyalty/loyalty.constants.ts`; the two
 * pre-existing producers (`LoyaltyPointsAwarded`, `LoyaltyPointsExpired`) are
 * documented here from their ACTUAL emitted payloads, not from the earlier
 * design sketch in `docs/phase2-scoping-plan.md` §5 (whose
 * `LoyaltyPointsExpired` row lists different field names).
 *
 * `LoyaltyPointsAdjusted.v1` is produced by the admin adjustment route
 * (`POST /v1/members/:memberId/points/adjust`) in the same transaction as the
 * ledger row and balance update. No consumer exists yet — the event is
 * persisted and dispatched with no registered handler, which the outbox marks
 * processed by design.
 *
 * MUST stay in lockstep with `src/loyalty/loyalty.constants.ts`
 * (`LOYALTY_EVENT_TYPES` / `LOYALTY_EVENT_VERSION`) and `docs/event-contracts.md`.
 * The backend does not import this package at build time (`tsconfig.json` sets
 * `rootDir` to `./src` and excludes `packages`), but `tsconfig.spec.json`
 * includes it, so the typecheck gate covers this file.
 */

// ---------------------------------------------------------------------------
// LoyaltyPointsAwarded — emitted by LoyaltyAccrualService.awardForTrigger()
// ---------------------------------------------------------------------------

export interface LoyaltyPointsAwardedPayload {
  accountId: string;
  memberId: string;
  points: number;
  transactionId: string;
  referenceType: string;
  referenceId: string | null;
  description: string;
}

export type LoyaltyPointsAwardedEvent = EventEnvelope<LoyaltyPointsAwardedPayload>;

// ---------------------------------------------------------------------------
// LoyaltyPointsExpired — emitted by LoyaltyExpiryService.expireTransaction()
// ---------------------------------------------------------------------------

export interface LoyaltyPointsExpiredPayload {
  accountId: string;
  /** The earn transaction whose remaining points were zeroed. */
  transactionId: string;
  /** The new `expire` ledger row. */
  expireTransactionId: string;
  pointsExpired: number;
}

export type LoyaltyPointsExpiredEvent = EventEnvelope<LoyaltyPointsExpiredPayload>;

// ---------------------------------------------------------------------------
// LoyaltyPointsAdjusted — emitted by LoyaltyAdjustService.adjust()
// ---------------------------------------------------------------------------

export interface LoyaltyPointsAdjustedPayload {
  accountId: string;
  memberId: string;
  transactionId: string;
  /** Signed delta: positive credited the member, negative debited them. */
  points: number;
  /** Account balance after the adjustment (current balance on an idempotent replay). */
  balanceAfter: number;
  reason: string;
  /** Staff user id, or null when the caller could not be resolved. */
  adjustedBy: string | null;
}

export type LoyaltyPointsAdjustedEvent = EventEnvelope<LoyaltyPointsAdjustedPayload>;

// ---------------------------------------------------------------------------
// Union type and constants
// ---------------------------------------------------------------------------

export type LoyaltyEvent =
  | LoyaltyPointsAwardedEvent
  | LoyaltyPointsExpiredEvent
  | LoyaltyPointsAdjustedEvent;

export const LOYALTY_EVENT_TYPES = {
  LOYALTY_POINTS_AWARDED: 'LoyaltyPointsAwarded',
  LOYALTY_POINTS_EXPIRED: 'LoyaltyPointsExpired',
  LOYALTY_POINTS_ADJUSTED: 'LoyaltyPointsAdjusted',
} as const;

export const LOYALTY_EVENT_VERSION = 'v1';
