import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MembersService } from '../../members/services/members.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { sumMoney, toMoney } from '../finance.constants';
import { QueryFinancialReportDto } from '../dto/query-financial-report.dto';
import {
  AgeingBucket,
  FINANCE_LEDGER_VIEWS,
  ReportPeriod,
  ageingBucket,
  ageingBucketIndex,
  outstandingStatusIndex,
  sqlIdentifier,
} from '../ledger.constants';

/**
 * P3-01 Finance ledger read service (`docs/phase3-scoping-plan.md` §1).
 *
 * This service ONLY reads. It is the whole point of the task: the ledger is a
 * read model derived from `FINANCE_INVOICES` / `FINANCE_PAYMENTS`, never a
 * second source of truth. Consequently:
 *
 *   - no repository write method is called anywhere in this file, and no
 *     `EntityManager`/`transaction` is used (asserted by
 *     `ledger.service.spec.ts`);
 *   - every query is issued as an explicitly org-scoped raw `SELECT` against a
 *     view through the injected `DataSource`, with the authorized organization
 *     bound as a parameter (`WHERE organization_id = $1`) — §1's prescribed
 *     pattern, matching how the views expose `organization_id`;
 *   - the views carry no TypeORM entity, so nothing here can be mistaken for a
 *     writable table.
 *
 * The organization is never taken from the request: it is derived from the
 * authorized tenant context (same pattern as `InvoicesService` and
 * `MembershipsService`), so one tenant cannot read another's ledger.
 */

/** Response of `GET /v1/members/{id}/outstanding-balance`. */
export interface MemberOutstandingBalance {
  member_id: string;
  organization_id: string;
  /** ISO-4217 code of the organization (`TENANCY_ORGANIZATIONS.currency`). */
  currency: string | null;
  /** total_invoiced - total_paid, floored at 0.00. */
  outstanding_balance: string;
  /** Sum of `total_amount` over invoices still in an outstanding status. */
  total_invoiced: string;
  /** Succeeded payments applied to those invoices. */
  total_paid: string;
  invoice_count: number;
  oldest_due_date: string | null;
  /** Whole days the oldest outstanding invoice is past its due date. */
  days_overdue: number;
  /** Ageing bucket of the oldest outstanding invoice. */
  ageing_bucket: AgeingBucket;
}

/** One rolled-up period of `GET /v1/financial-reports/revenue-summary`. */
export interface RevenueSummaryBucket {
  period_start: string;
  branch_id: string | null;
  currency: string | null;
  payment_count: number;
  revenue_amount: string;
}

/** Response of `GET /v1/financial-reports/revenue-summary`. */
export interface RevenueSummary {
  organization_id: string;
  from: string | null;
  to: string | null;
  period: ReportPeriod;
  branch_id: string | null;
  total_revenue: string;
  buckets: RevenueSummaryBucket[];
}

/** One status/ageing row of `GET /v1/financial-reports/outstanding-by-status`. */
export interface OutstandingByStatusBucket {
  status: string;
  ageing_bucket: string;
  invoice_count: number;
  total_invoiced: string;
  total_paid: string;
  outstanding_balance: string;
}

/** Response of `GET /v1/financial-reports/outstanding-by-status`. */
export interface OutstandingByStatus {
  organization_id: string;
  total_outstanding: string;
  buckets: OutstandingByStatusBucket[];
}

/** Raw shape of a `V_FINANCE_MEMBER_OUTSTANDING` row. */
interface MemberOutstandingRow {
  organization_id: string;
  member_id: string;
  currency: string | null;
  total_invoiced: string;
  total_paid: string;
  outstanding_balance: string;
  invoice_count: string | number;
  oldest_due_date: Date | string | null;
  days_overdue: string | number | null;
}

/** Raw shape of a rolled-up `V_FINANCE_REVENUE_BY_PERIOD` row. */
interface RevenueRow {
  branch_id: string | null;
  currency: string | null;
  period_start: Date | string;
  payment_count: string | number;
  revenue_amount: string;
}

/** Raw shape of a `V_FINANCE_OUTSTANDING_BY_STATUS` row. */
interface OutstandingByStatusRow {
  status: string;
  ageing_bucket: string;
  invoice_count: string | number;
  total_invoiced: string;
  total_paid: string;
  outstanding_balance: string;
}

@Injectable()
export class LedgerService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly membersService: MembersService,
    private readonly tenantContextService: TenantContextService,
  ) {}

  /**
   * Authorized organization, mirroring `InvoicesService.resolveAuthorizedOrg`.
   * Duplicated deliberately: it is the same three-line tenant rule used by the
   * other finance/membership services, and extracting it would put a shared
   * tenant helper between the services and the context they authorize against.
   */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /** Read-only lookup of the organization's currency (an existing table). */
  private async resolveOrgCurrency(organizationId: string): Promise<string | null> {
    const rows: Array<{ currency: string | null }> = await this.dataSource.query(
      'SELECT currency FROM "TENANCY_ORGANIZATIONS" WHERE id = $1',
      [organizationId],
    );
    return rows.length > 0 ? rows[0].currency : null;
  }

  /**
   * Outstanding balance for one member (`GET /v1/members/{id}/outstanding-balance`).
   *
   * Reads `V_FINANCE_MEMBER_OUTSTANDING`, which §1 defines as: the sum of
   * `total_amount` over invoices in an outstanding status, minus the succeeded
   * payments applied to those invoices, floored at zero.
   *
   * Two properties worth knowing:
   *   - A fully paid or voided invoice contributes nothing: it is excluded from
   *     the view, and its net contribution to the balance was zero anyway.
   *   - `total_paid` counts only payments against *still-outstanding* invoices,
   *     so `total_invoiced - total_paid` is exactly `outstanding_balance` unless
   *     the floor applied (an over-payment).
   */
  async getMemberOutstandingBalance(memberId: string): Promise<MemberOutstandingBalance> {
    const organizationId = await this.resolveAuthorizedOrg();

    // Member validation through MembersService (provided by MembersModule):
    // `findOne` is org-scoped and throws NotFoundException for a member of
    // another organization, so the endpoint cannot be used to probe for
    // cross-tenant member ids.
    await this.membersService.findOne(memberId);

    const rows: MemberOutstandingRow[] = await this.dataSource.query(
      `SELECT organization_id, member_id, currency, total_invoiced, total_paid,
              outstanding_balance, invoice_count, oldest_due_date, days_overdue
         FROM ${sqlIdentifier(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING)}
        WHERE organization_id = $1 AND member_id = $2`,
      [organizationId, memberId],
    );

    if (rows.length === 0) {
      // A member with nothing owed has no view row: the view is derived from
      // invoices, so "nothing outstanding" is the absence of a row rather than a
      // 0.00 row. The currency is still reported, from the organization.
      return {
        member_id: memberId,
        organization_id: organizationId,
        currency: await this.resolveOrgCurrency(organizationId),
        outstanding_balance: '0.00',
        total_invoiced: '0.00',
        total_paid: '0.00',
        invoice_count: 0,
        oldest_due_date: null,
        days_overdue: 0,
        ageing_bucket: ageingBucket(0),
      };
    }

    const row = rows[0];
    const daysOverdue = Number(row.days_overdue ?? 0);

    return {
      member_id: row.member_id,
      organization_id: row.organization_id,
      currency: row.currency,
      outstanding_balance: toMoney(row.outstanding_balance),
      total_invoiced: toMoney(row.total_invoiced),
      total_paid: toMoney(row.total_paid),
      invoice_count: Number(row.invoice_count),
      oldest_due_date: row.oldest_due_date
        ? LedgerService.toDateString(row.oldest_due_date)
        : null,
      days_overdue: daysOverdue,
      ageing_bucket: ageingBucket(daysOverdue),
    };
  }

  /**
   * Revenue by period (`GET /v1/financial-reports/revenue-summary`).
   *
   * `V_FINANCE_REVENUE_BY_PERIOD` stores one row per day; this rolls those rows
   * up to the requested `period` with `date_trunc`. Refunds are not netted off
   * yet (`FINANCE_REFUNDS` is P3-02), so the figure is gross money received
   * through succeeded payments.
   */
  async getRevenueSummary(query: QueryFinancialReportDto): Promise<RevenueSummary> {
    const organizationId = await this.resolveAuthorizedOrg();
    const period: ReportPeriod = query.period ?? 'month';

    // $1 is always the authorized organization and $2 the roll-up granularity,
    // so every later parameter is appended in order and referenced by position.
    const params: unknown[] = [organizationId, period];
    const filters: string[] = ['organization_id = $1'];

    if (query.branch_id) {
      params.push(query.branch_id);
      filters.push(`branch_id = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      filters.push(`period_start >= $${params.length}::date`);
    }
    if (query.to) {
      params.push(query.to);
      filters.push(`period_start <= $${params.length}::date`);
    }

    // The inner query rolls each day up to the requested granularity, because
    // the view stores the finest period; the outer one re-aggregates across
    // branches/currencies, matching the view's own grouping keys.
    const rows: RevenueRow[] = await this.dataSource.query(
      `SELECT organization_id, branch_id, currency, period_start,
              SUM(payment_count) AS payment_count,
              SUM(revenue_amount) AS revenue_amount
         FROM (
             SELECT organization_id, branch_id, currency,
                    date_trunc($2::text, period_start::timestamp)::date AS period_start,
                    payment_count, revenue_amount
               FROM ${sqlIdentifier(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD)}
              WHERE ${filters.join(' AND ')}
         ) periods
        GROUP BY organization_id, branch_id, currency, period_start
        ORDER BY period_start ASC, branch_id ASC NULLS FIRST, currency ASC`,
      params,
    );

    const buckets: RevenueSummaryBucket[] = rows.map((row) => ({
      period_start: LedgerService.toDateString(row.period_start),
      branch_id: row.branch_id,
      currency: row.currency,
      payment_count: Number(row.payment_count),
      revenue_amount: toMoney(row.revenue_amount),
    }));

    return {
      organization_id: organizationId,
      from: query.from ?? null,
      to: query.to ?? null,
      period,
      branch_id: query.branch_id ?? null,
      total_revenue: sumMoney(buckets.map((bucket) => bucket.revenue_amount)),
      buckets,
    };
  }

  /**
   * Outstanding invoices grouped by status and ageing bucket
   * (`GET /v1/financial-reports/outstanding-by-status`).
   *
   * No currency is reported: the rows add across every invoice the organization
   * has, so a single code would be misleading rather than informative. The
   * member-balance and revenue responses, which are per-currency by
   * construction, do carry one.
   *
   * Rows are ordered by status (the order money becomes owed: draft → sent →
   * partially_paid) and then by ageing severity, so the response reads as a
   * conventional ageing report.
   */
  async getOutstandingByStatus(): Promise<OutstandingByStatus> {
    const organizationId = await this.resolveAuthorizedOrg();

    const rows: OutstandingByStatusRow[] = await this.dataSource.query(
      `SELECT status, ageing_bucket, invoice_count, total_invoiced, total_paid, outstanding_balance
         FROM ${sqlIdentifier(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)}
        WHERE organization_id = $1`,
      [organizationId],
    );

    const buckets: OutstandingByStatusBucket[] = rows
      .map((row) => ({
        status: row.status,
        ageing_bucket: row.ageing_bucket,
        invoice_count: Number(row.invoice_count),
        total_invoiced: toMoney(row.total_invoiced),
        total_paid: toMoney(row.total_paid),
        outstanding_balance: toMoney(row.outstanding_balance),
      }))
      .sort(
        (a, b) =>
          outstandingStatusIndex(a.status) - outstandingStatusIndex(b.status) ||
          ageingBucketIndex(a.ageing_bucket) - ageingBucketIndex(b.ageing_bucket),
      );

    return {
      organization_id: organizationId,
      total_outstanding: sumMoney(buckets.map((bucket) => bucket.outstanding_balance)),
      buckets,
    };
  }

  /**
   * `date` columns come back from `pg` as `YYYY-MM-DD` strings, but a driver
   * that materialises them as `Date` would shift them by the local offset. Both
   * shapes are normalised to a plain calendar date.
   *
   * The `Date` branch deliberately reads LOCAL calendar parts rather than
   * `toISOString()`. `pg` builds a `date` as local midnight, so in any non-UTC
   * server timezone `toISOString().slice(0, 10)` would report the PREVIOUS day
   * (e.g. `2026-06-20` in IST serialises as `2026-06-19T18:30:00.000Z`) — every
   * reported period would be off by one. Local getters round-trip the calendar
   * date exactly.
   */
  private static toDateString(value: Date | string): string {
    if (!(value instanceof Date)) return String(value).slice(0, 10);
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
}

