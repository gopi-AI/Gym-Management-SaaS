import { IsOptional, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { LOYALTY_TRANSACTION_TYPES } from '../loyalty.constants';

/**
 * Read-side DTOs for the loyalty module (P6-28).
 *
 * Shapes are driven by what consumes them rather than invented:
 *   - `LoyaltyBalanceResponse` / `LoyaltyTransactionsResponse` follow the routes
 *     P2-08 declares — `GET /v1/members/{memberId}/points/balance` and
 *     `.../points/transactions` — whose acceptance criteria are "shows current
 *     points balance" and "lists earning and redemption transactions".
 *   - `LoyaltyDashboardResponse` carries exactly the three figures §6.7's Loyalty
 *     Reports rows define, because P6-19's dashboard is a §12 row with no other
 *     description of what it renders:
 *       * `pointsIssuedBurned`  <- "Points Issued/Burned" (transaction_type,
 *                                  count, total_points)
 *       * `redemptionRate`      <- "Redemption Rate" (issued, redeemed, rate)
 *       * `activeAccounts`      <- "Active Loyalty Accounts" (COUNT(DISTINCT
 *                                  account_id) over the period), as redefined by
 *                                  P6-25 resolution (D)
 */

/** `GET /v1/loyalty/dashboard` — the period the aggregates cover. */
export class QueryLoyaltyDashboardDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** `GET /v1/members/:memberId/points/transactions`. */
export class QueryLoyaltyTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * A member's points position.
 *
 * `accountId` is `null` when the member has no loyalty account yet: accounts are
 * created lazily by the first point-earning event (`LoyaltyAccrualService`), so a
 * member with no activity legitimately has none. Returning zeros with a null id
 * is deliberate — a 404 here would make every dashboard render a special case for
 * "no activity yet", which is a normal state rather than an error.
 */
export class LoyaltyBalanceResponse {
  memberId!: string;
  accountId!: string | null;
  balance!: number;
  lifetimePointsEarned!: number;
  lifetimePointsRedeemed!: number;
  tier!: string | null;
  updatedAt!: Date | null;
}

/** One ledger row. Mirrors `LoyaltyTransaction`; always positive `points`. */
export class LoyaltyTransactionResponseItem {
  id!: string;
  transactionType!: string;
  points!: number;
  remainingPoints!: number;
  referenceType!: string | null;
  referenceId!: string | null;
  description!: string | null;
  expiresAt!: Date | null;
  createdAt!: Date;
}

export class LoyaltyTransactionsResponse {
  data!: LoyaltyTransactionResponseItem[];
  total!: number;
  page!: number;
  limit!: number;
}

/** §6.7 "Points Issued/Burned": movements per transaction type over the period. */
export class LoyaltyTransactionTypeSummary {
  transactionType!: string;
  count!: number;
  totalPoints!: number;
}

/**
 * §6.7 "Redemption Rate": points burned vs. issued over the period.
 *
 * `rate` is `redeemed / issued`, and `0` when nothing was issued — the row's own
 * columns are `period, issued, redeemed, rate`, and dividing by zero has no
 * meaningful answer here, so it reports 0 rather than null or Infinity.
 */
export class LoyaltyRedemptionRate {
  issued!: number;
  redeemed!: number;
  rate!: number;
}

export class LoyaltyDashboardResponse {
  from!: string;
  to!: string;
  pointsIssuedBurned!: LoyaltyTransactionTypeSummary[];
  redemptionRate!: LoyaltyRedemptionRate;
  /**
   * §6.7 with P6-25's resolution (D): an account is active in a period if it has
   * at least one `LoyaltyTransaction` in that period.
   */
  activeAccounts!: number;
}

/** The transaction types §6.7 wants broken out, in a stable order. */
export const LOYALTY_DASHBOARD_TRANSACTION_TYPES: string[] = [
  LOYALTY_TRANSACTION_TYPES.EARN,
  LOYALTY_TRANSACTION_TYPES.REDEEM,
  LOYALTY_TRANSACTION_TYPES.EXPIRE,
  LOYALTY_TRANSACTION_TYPES.ADJUST,
];
