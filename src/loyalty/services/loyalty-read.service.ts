import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { MembersService } from '../../members/services/members.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { LOYALTY_TRANSACTION_TYPES } from '../loyalty.constants';
import {
  LOYALTY_DASHBOARD_TRANSACTION_TYPES,
  LoyaltyBalanceResponse,
  LoyaltyDashboardResponse,
  LoyaltyTransactionResponseItem,
  LoyaltyTransactionTypeSummary,
  LoyaltyTransactionsResponse,
} from '../dto/loyalty-read.dto';

/** Default reporting window when the caller supplies no `from`/`to`. */
const DEFAULT_DASHBOARD_WINDOW_DAYS = 30;

/**
 * Read/aggregate surface for the loyalty module (P6-28).
 *
 * Before this service the module exposed **no read method at all**: every
 * repository query in it was a write-path lookup, and nothing outside the module
 * read loyalty data. That left P6-19's dashboard with no data source, which is
 * the gap this closes.
 *
 * **Tenancy is enforced twice, deliberately.**
 *   1. The authorized organization comes from `TenantContextService` — the
 *      request-scoped context, never a caller-supplied id. Every query filters on
 *      `organization_id`. `LOYALTY_TRANSACTIONS.organization_id` (P6-25 resolution
 *      D, written by both writers) is what makes that possible for the ledger;
 *      `LOYALTY_ACCOUNTS` has always carried it.
 *   2. Member-scoped reads additionally resolve the member through
 *      `MembersService.findOne()`, which is itself org-scoped and throws
 *      `NotFoundException`. A member id belonging to another organization is
 *      therefore rejected with 404, not silently answered with zeros — the same
 *      behaviour `Member360Controller` documents for its own member-scoped reads.
 *
 * The second check is not redundant with the first: without it a cross-tenant
 * member id would return a zeroed balance, which is a different (and less honest)
 * answer than "that member is not in your organization".
 */
@Injectable()
export class LoyaltyReadService {
  private readonly logger = new Logger(LoyaltyReadService.name);

  constructor(
    @InjectRepository(LoyaltyAccount)
    private readonly accountRepository: Repository<LoyaltyAccount>,
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionRepository: Repository<LoyaltyTransaction>,
    private readonly membersService: MembersService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  /**
   * The AUTHORIZED organization for this request.
   *
   * Throws rather than returning null when no organization is in context: a read
   * with no tenant scope has no safe answer, and returning empty results would
   * hide a wiring problem behind a plausible-looking response.
   */
  private async resolveAuthorizedOrg(): Promise<string> {
    const organizationId = await this.tenantContextService.getCurrentOrganizationId();
    if (!organizationId) {
      throw new ForbiddenException('No authorized organization in the request context');
    }
    return organizationId;
  }

  /**
   * Rejects a member that is not in the caller's organization (404), so member
   * ids cannot be probed across tenants.
   */
  private async assertMemberInOrganization(memberId: string): Promise<void> {
    await this.membersService.findOne(memberId);
  }

  /**
   * A member's points position (P2-08's `GET /v1/members/{memberId}/points/balance`).
   *
   * A member with no loyalty account yet is not an error — accounts are created by
   * the first earning event — so this returns a zeroed balance with `accountId:
   * null` rather than 404.
   */
  async getBalance(memberId: string): Promise<LoyaltyBalanceResponse> {
    const organizationId = await this.resolveAuthorizedOrg();
    await this.assertMemberInOrganization(memberId);

    const account = await this.accountRepository.findOne({
      where: { organization_id: organizationId, member_id: memberId },
    });

    if (!account) {
      return {
        memberId,
        accountId: null,
        balance: 0,
        lifetimePointsEarned: 0,
        lifetimePointsRedeemed: 0,
        tier: null,
        updatedAt: null,
      };
    }

    return {
      memberId,
      accountId: account.id,
      balance: account.balance,
      lifetimePointsEarned: account.lifetime_points_earned,
      lifetimePointsRedeemed: account.lifetime_points_redeemed,
      tier: account.tier ?? null,
      updatedAt: account.updated_at,
    };
  }

  /**
   * A member's ledger, newest first
   * (P2-08's `GET /v1/members/{memberId}/points/transactions`).
   *
   * Scoped by BOTH `account_id` and `organization_id`: the account lookup is
   * already org-scoped, and the ledger filter repeats the organization so the
   * tenant predicate is present on the query that returns rows rather than only on
   * the lookup that authorises them.
   */
  async getTransactions(
    memberId: string,
    query: { page?: number; limit?: number },
  ): Promise<LoyaltyTransactionsResponse> {
    const organizationId = await this.resolveAuthorizedOrg();
    await this.assertMemberInOrganization(memberId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const account = await this.accountRepository.findOne({
      where: { organization_id: organizationId, member_id: memberId },
    });

    // No account means no ledger rows — an empty page, not an error.
    if (!account) {
      return { data: [], total: 0, page, limit };
    }

    const [rows, total] = await this.transactionRepository.findAndCount({
      where: { organization_id: organizationId, account_id: account.id },
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: rows.map((row) => this.toResponseItem(row)),
      total,
      page,
      limit,
    };
  }

  /**
   * The organization's loyalty figures for a period — exactly the three §6.7 rows
   * P6-19's dashboard renders, so no figure is computed in the browser from raw
   * entity rows (P6-28's second acceptance criterion).
   *
   * The window defaults to the last 30 days when `from`/`to` are omitted, because
   * all three §6.7 rows carry a `date_range` filter and a dashboard has to open on
   * *some* period. `from` is inclusive, `to` exclusive.
   */
  async getDashboard(query: { from?: string; to?: string }): Promise<LoyaltyDashboardResponse> {
    const organizationId = await this.resolveAuthorizedOrg();
    const { from, to } = this.resolveWindow(query);

    const grouped = await this.transactionRepository
      .createQueryBuilder('t')
      .select('t.transaction_type', 'transactionType')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(t.points), 0)', 'totalPoints')
      .where('t.organization_id = :organizationId', { organizationId })
      .andWhere('t.created_at >= :from', { from })
      .andWhere('t.created_at < :to', { to })
      .groupBy('t.transaction_type')
      .getRawMany<{ transactionType: string; count: string; totalPoints: string }>();

    const byType = new Map<string, { count: number; totalPoints: number }>();
    for (const row of grouped) {
      byType.set(row.transactionType, {
        count: Number(row.count),
        totalPoints: Number(row.totalPoints),
      });
    }

    // Every type is reported, including those with no activity, so the response
    // shape does not change with the data.
    const pointsIssuedBurned: LoyaltyTransactionTypeSummary[] =
      LOYALTY_DASHBOARD_TRANSACTION_TYPES.map((transactionType) => ({
        transactionType,
        count: byType.get(transactionType)?.count ?? 0,
        totalPoints: byType.get(transactionType)?.totalPoints ?? 0,
      }));

    const issued = byType.get(LOYALTY_TRANSACTION_TYPES.EARN)?.totalPoints ?? 0;
    const redeemed = byType.get(LOYALTY_TRANSACTION_TYPES.REDEEM)?.totalPoints ?? 0;

    const activeRow = await this.transactionRepository
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t.account_id)', 'count')
      .where('t.organization_id = :organizationId', { organizationId })
      .andWhere('t.created_at >= :from', { from })
      .andWhere('t.created_at < :to', { to })
      .getRawOne<{ count: string }>();

    this.logger.debug(
      `Loyalty dashboard for org ${organizationId}: ${issued} issued, ${redeemed} redeemed, ` +
        `${activeRow?.count ?? 0} active accounts`,
    );

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      pointsIssuedBurned,
      redemptionRate: {
        issued,
        redeemed,
        rate: issued > 0 ? redeemed / issued : 0,
      },
      activeAccounts: Number(activeRow?.count ?? 0),
    };
  }

  private resolveWindow(query: { from?: string; to?: string }): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - DEFAULT_DASHBOARD_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid reporting window: from/to must be valid dates');
    }
    if (from >= to) {
      throw new BadRequestException('Invalid reporting window: from must precede to');
    }
    return { from, to };
  }

  private toResponseItem(row: LoyaltyTransaction): LoyaltyTransactionResponseItem {
    return {
      id: row.id,
      transactionType: row.transaction_type,
      points: row.points,
      remainingPoints: row.remaining_points,
      referenceType: row.reference_type ?? null,
      referenceId: row.reference_id ?? null,
      description: row.description ?? null,
      expiresAt: row.expires_at ?? null,
      createdAt: row.created_at,
    };
  }
}
