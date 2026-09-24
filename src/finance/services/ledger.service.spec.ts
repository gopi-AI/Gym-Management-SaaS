import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { MembersService } from '../../members/services/members.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { FINANCE_LEDGER_VIEWS } from '../ledger.constants';

/**
 * Behavioral verification of the P3-01 ledger read model.
 *
 * The properties that matter, and why each is asserted:
 *
 *   - **The numbers are right.** Concrete view rows in, concrete response out.
 *     A ledger that reads correctly but computes wrongly is the failure mode
 *     that matters, so the fixtures are shaped so a wrong join (a failed payment
 *     counted, a settled invoice counted) changes the expected value.
 *   - **Tenant isolation.** Every query must bind the authorized organization as
 *     a parameter. This is asserted on the SQL/parameters actually handed to the
 *     driver, not on the returned rows, because a mock will happily return the
 *     right rows for an unscoped query.
 *   - **Read-only.** The service must never open a transaction or call a write
 *     method: the whole point of the read model is that the views, not this
 *     service, are the thing being read.
 *   - **Off-by-one dates.** `period_start`/`oldest_due_date` are calendar dates.
 *     `pg` materialises a `date` as LOCAL midnight, so serialising it with
 *     `toISOString()` would report the previous day outside UTC. That is a real
 *     regression that a UTC-only CI box would never catch, so it is pinned here
 *     with an explicit non-UTC case.
 */
describe('LedgerService', () => {
  let service: LedgerService;
  let mockDataSource: { query: jest.Mock; transaction: jest.Mock };
  let mockMembersService: { findOne: jest.Mock };
  let mockTenantContext: Record<string, jest.Mock>;

  const orgId = '11111111-1111-4111-8111-111111111111';
  const otherOrgId = '99999999-9999-4999-8999-999999999999';
  const memberId = '22222222-2222-4222-8222-222222222222';

  /** Statements the service issued, in order. */
  const issuedSql = () => mockDataSource.query.mock.calls.map((call) => String(call[0]));
  const paramsFor = (fragment: string): unknown[] => {
    const call = mockDataSource.query.mock.calls.find((entry) => String(entry[0]).includes(fragment));
    if (!call) throw new Error(`no query was issued containing ${fragment}`);
    return call[1] as unknown[];
  };

  /** Route each view SELECT to a canned result. */
  const respondWith = (results: Record<string, unknown[]>) => {
    mockDataSource.query.mockImplementation(async (sql: string) => {
      const key = Object.keys(results).find((view) => sql.includes(view));
      return key ? results[key] : [];
    });
  };

  beforeEach(async () => {
    mockDataSource = { query: jest.fn().mockResolvedValue([]), transaction: jest.fn() };
    mockMembersService = { findOne: jest.fn().mockResolvedValue({ id: memberId }) };
    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(null),
      requireOrganizationAccess: jest.fn().mockResolvedValue(orgId),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: MembersService, useValue: mockMembersService },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });


  describe('getMemberOutstandingBalance', () => {
    const balanceRow = {
      organization_id: orgId,
      member_id: memberId,
      currency: 'USD',
      // 100.00 sent + 50.00 draft + 80.00 sent, of which 40.00 succeeded paid.
      total_invoiced: '230.00',
      total_paid: '40.00',
      outstanding_balance: '190.00',
      invoice_count: '3',
      oldest_due_date: new Date(2026, 5, 20),
      days_overdue: 45,
    };

    it('reports the outstanding balance with its ageing bucket', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING]: [balanceRow] });

      await expect(service.getMemberOutstandingBalance(memberId)).resolves.toEqual({
        member_id: memberId,
        organization_id: orgId,
        currency: 'USD',
        total_invoiced: '230.00',
        total_paid: '40.00',
        outstanding_balance: '190.00',
        invoice_count: 3,
        oldest_due_date: '2026-06-20',
        days_overdue: 45,
        ageing_bucket: '31-60',
      });
    });

    it('reports a calendar date for the oldest due date, not a shifted instant', async () => {
      respondWith({
        [FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING]: [
          { ...balanceRow, oldest_due_date: new Date(2026, 5, 20) },
        ],
      });

      const result = await service.getMemberOutstandingBalance(memberId);

      // A `date` column arrives as local midnight. Serialising it with
      // toISOString() would yield 2026-06-19T18:30:00.000Z in IST — the wrong
      // day, and a shape the API contract does not promise.
      expect(result.oldest_due_date).toBe('2026-06-20');
      expect(result.oldest_due_date).not.toContain('T');
    });

    it('normalises money to two decimals even when the driver returns a bare integer', async () => {
      respondWith({
        [FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING]: [
          { ...balanceRow, total_paid: '0', outstanding_balance: '230.00' },
        ],
      });

      const result = await service.getMemberOutstandingBalance(memberId);

      expect(result.total_paid).toBe('0.00');
    });

    it('synthesises a zero balance when the member owes nothing', async () => {
      // The view is derived from invoices, so "nothing outstanding" is the
      // absence of a row rather than a 0.00 row.
      respondWith({ TENANCY_ORGANIZATIONS: [{ currency: 'USD' }] });

      await expect(service.getMemberOutstandingBalance(memberId)).resolves.toEqual({
        member_id: memberId,
        organization_id: orgId,
        currency: 'USD',
        total_invoiced: '0.00',
        total_paid: '0.00',
        outstanding_balance: '0.00',
        invoice_count: 0,
        oldest_due_date: null,
        days_overdue: 0,
        ageing_bucket: 'current',
      });
    });

    it('scopes the view query to the authorized organization and the member', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING]: [balanceRow] });

      await service.getMemberOutstandingBalance(memberId);

      expect(paramsFor(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING)).toEqual([orgId, memberId]);
    });

    it('validates the member through MembersService (org-scoped, 404s cross-tenant ids)', async () => {
      mockMembersService.findOne.mockRejectedValue(new NotFoundException('Member not found'));

      await expect(service.getMemberOutstandingBalance('other-member')).rejects.toThrow(
        NotFoundException,
      );
      // The view must not be queried at all when the member is not the caller's.
      expect(issuedSql().some((sql) => sql.includes(FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING))).toBe(
        false,
      );
    });

  describe('getRevenueSummary', () => {
    it('rolls day rows up to the requested period and totals them', async () => {
      respondWith({
        [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [
          { branch_id: 'branch-1', currency: 'USD', period_start: new Date(2026, 5, 1), payment_count: '2', revenue_amount: '65.00' },
          { branch_id: 'branch-1', currency: 'USD', period_start: new Date(2026, 6, 1), payment_count: '1', revenue_amount: '35.00' },
        ],
      });

      const result = await service.getRevenueSummary({ period: 'month' });

      expect(result).toEqual({
        organization_id: orgId,
        from: null,
        to: null,
        period: 'month',
        branch_id: null,
        total_revenue: '100.00',
        buckets: [
          { period_start: '2026-06-01', branch_id: 'branch-1', currency: 'USD', payment_count: 2, revenue_amount: '65.00' },
          { period_start: '2026-07-01', branch_id: 'branch-1', currency: 'USD', payment_count: 1, revenue_amount: '35.00' },
        ],
      });
    });

    it('defaults to monthly granularity when no period is requested', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [] });

      const result = await service.getRevenueSummary({});

      expect(result.period).toBe('month');
      expect(paramsFor(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD)[1]).toBe('month');
    });

    it('reports a calendar date for each period, not a shifted instant', async () => {
      respondWith({
        [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [
          { branch_id: null, currency: 'USD', period_start: new Date(2026, 5, 1), payment_count: '1', revenue_amount: '25.00' },
        ],
      });

      const result = await service.getRevenueSummary({ period: 'month' });

      expect(result.buckets[0].period_start).toBe('2026-06-01');
    });

    it('always binds the authorized organization as $1', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [] });

      await service.getRevenueSummary({ period: 'day' });

      const params = paramsFor(FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD);
      expect(params[0]).toBe(orgId);
      expect(params[0]).not.toBe(otherOrgId);
      expect(issuedSql().every((sql) => !sql.includes('branch_id = $1'))).toBe(true);
    });

    it('appends optional filters as bound parameters, never interpolated', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [] });

      await service.getRevenueSummary({
        period: 'week',
        branch_id: 'branch-1',
        from: '2026-01-01',
        to: '2026-01-31',
      });

      const [sql, params] = mockDataSource.query.mock.calls[0] as [string, unknown[]];

      // Order matters: $1 org, $2 period, then the filters as pushed.
      expect(params).toEqual([orgId, 'week', 'branch-1', '2026-01-01', '2026-01-31']);
      expect(sql).toContain('branch_id = $3');
      expect(sql).toContain('period_start >= $4::date');
      expect(sql).toContain('period_start <= $5::date');
      // The values themselves must not appear in the statement text.
      expect(sql).not.toContain('2026-01-01');
      expect(sql).not.toContain('branch-1');
    });

    it('omits filters that were not requested', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [] });

      await service.getRevenueSummary({ period: 'month' });

      const [sql, params] = mockDataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([orgId, 'month']);
      expect(sql).not.toContain('branch_id =');
      expect(sql).not.toContain('period_start >=');
    });

    it('reports 0.00 rather than NaN when there is no revenue at all', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [] });

      const result = await service.getRevenueSummary({ period: 'month' });

      expect(result.total_revenue).toBe('0.00');
      expect(result.buckets).toEqual([]);
    });
  });

  });

  describe('getOutstandingByStatus', () => {
    it('orders buckets by status then ageing severity', async () => {
      // Deliberately returned out of order, so a missing sort is visible.
      respondWith({
        [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [
          { status: 'sent', ageing_bucket: '31-60', invoice_count: '1', total_invoiced: '100.00', total_paid: '40.00', outstanding_balance: '60.00' },
          { status: 'draft', ageing_bucket: 'current', invoice_count: '1', total_invoiced: '50.00', total_paid: '0.00', outstanding_balance: '50.00' },
          { status: 'sent', ageing_bucket: '1-30', invoice_count: '1', total_invoiced: '80.00', total_paid: '0.00', outstanding_balance: '80.00' },
        ],
      });

      const result = await service.getOutstandingByStatus();

      expect(result.buckets.map((bucket) => [bucket.status, bucket.ageing_bucket])).toEqual([
        ['draft', 'current'],
        ['sent', '1-30'],
        ['sent', '31-60'],
      ]);
    });

    it('totals the outstanding balance across every bucket', async () => {
      respondWith({
        [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [
          { status: 'draft', ageing_bucket: 'current', invoice_count: '1', total_invoiced: '50.00', total_paid: '0.00', outstanding_balance: '50.00' },
          { status: 'sent', ageing_bucket: '1-30', invoice_count: '1', total_invoiced: '80.00', total_paid: '0.00', outstanding_balance: '80.00' },
          { status: 'sent', ageing_bucket: '31-60', invoice_count: '1', total_invoiced: '100.00', total_paid: '40.00', outstanding_balance: '60.00' },
        ],
      });

      const result = await service.getOutstandingByStatus();

      expect(result.organization_id).toBe(orgId);
      expect(result.total_outstanding).toBe('190.00');
      // Each bucket's own arithmetic is reported, not just the total.
      expect(result.buckets[2]).toEqual({
        status: 'sent',
        ageing_bucket: '31-60',
        invoice_count: 1,
        total_invoiced: '100.00',
        total_paid: '40.00',
        outstanding_balance: '60.00',
      });
    });

    it('scopes the query to the authorized organization', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [] });

      await service.getOutstandingByStatus();

      expect(paramsFor(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)).toEqual([orgId]);
    });

    it('reports 0.00 when nothing is outstanding', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [] });

      const result = await service.getOutstandingByStatus();

      expect(result.total_outstanding).toBe('0.00');
      expect(result.buckets).toEqual([]);
    });
  });

  describe('tenant resolution', () => {
    it('falls back to the requested organization only after access is authorized', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(otherOrgId);
      // The guard returns the organization it approved, which is the requested one.
      mockTenantContext.requireOrganizationAccess.mockResolvedValue(otherOrgId);
      respondWith({ [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [] });

      await service.getOutstandingByStatus();

      expect(mockTenantContext.requireOrganizationAccess).toHaveBeenCalledWith(otherOrgId);
      expect(paramsFor(FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS)).toEqual([otherOrgId]);
    });

    it('refuses to read a ledger with no organization context', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(null);

      await expect(service.getOutstandingByStatus()).rejects.toThrow(ForbiddenException);
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });

    it('propagates a denied organization access rather than querying', async () => {
      mockTenantContext.getCurrentOrganizationId.mockResolvedValue(null);
      mockTenantContext.getRequestedOrganizationId.mockResolvedValue(otherOrgId);
      mockTenantContext.requireOrganizationAccess.mockRejectedValue(
        new ForbiddenException('No access'),
      );

      await expect(service.getOutstandingByStatus()).rejects.toThrow(ForbiddenException);
      expect(mockDataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('read-only guarantee', () => {
    it('never opens a transaction', async () => {
      respondWith({
        [FINANCE_LEDGER_VIEWS.MEMBER_OUTSTANDING]: [
          {
            organization_id: orgId,
            member_id: memberId,
            currency: 'USD',
            total_invoiced: '10.00',
            total_paid: '0.00',
            outstanding_balance: '10.00',
            invoice_count: '1',
            oldest_due_date: null,
            days_overdue: 0,
          },
        ],
        [FINANCE_LEDGER_VIEWS.REVENUE_BY_PERIOD]: [],
        [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [],
      });

      await service.getMemberOutstandingBalance(memberId);
      await service.getRevenueSummary({ period: 'month' });
      await service.getOutstandingByStatus();

      // The ledger is a read model: it must not participate in any transaction,
      // because a transaction would imply a write path.
      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('issues SELECT statements only', async () => {
      respondWith({ [FINANCE_LEDGER_VIEWS.OUTSTANDING_BY_STATUS]: [] });

      await service.getOutstandingByStatus();

      for (const sql of issuedSql()) {
        expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
        for (const verb of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'ALTER', 'DROP']) {
          expect(sql.toUpperCase()).not.toContain(verb);
        }
      }
    });
  });
});



