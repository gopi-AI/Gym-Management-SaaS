import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { FinancialReportsController } from './financial-reports.controller';
import { MemberOutstandingBalanceController } from './member-outstanding-balance.controller';
import { LedgerService } from '../services/ledger.service';
import { PERMISSIONS_KEY, RequiredPermission } from '../../shared/auth/permissions.guard';

/**
 * Verification of the two P3-01 ledger endpoints.
 *
 * The controllers are deliberately thin, so what is worth pinning is the
 * contract rather than the delegation: both routes are guarded by the EXISTING
 * `finance:read` permission (no new permission was provisioned for P3-01), and
 * neither passes a caller-supplied organization through — the service derives it
 * from the tenant context.
 */
describe('Ledger controllers', () => {
  const reflector = new Reflector();
  const permissionsFor = (controller: object, handler: string): RequiredPermission[] | undefined =>
    reflector.get<RequiredPermission[]>(PERMISSIONS_KEY, (controller as never)[handler] as Function);

  describe('MemberOutstandingBalanceController', () => {
    let controller: MemberOutstandingBalanceController;
    let mockService: { getMemberOutstandingBalance: jest.Mock };

    beforeEach(async () => {
      mockService = { getMemberOutstandingBalance: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [MemberOutstandingBalanceController],
        providers: [{ provide: LedgerService, useValue: mockService }],
      }).compile();

      controller = module.get<MemberOutstandingBalanceController>(MemberOutstandingBalanceController);
    });

    it('delegates the member id to the ledger service', async () => {
      const balance = { member_id: 'member-1', outstanding_balance: '190.00' };
      mockService.getMemberOutstandingBalance.mockResolvedValue(balance);

      await expect(controller.findOne('member-1')).resolves.toEqual(balance);
      expect(mockService.getMemberOutstandingBalance).toHaveBeenCalledWith('member-1');
    });

    it('passes only the member id — never an organization from the request', async () => {
      mockService.getMemberOutstandingBalance.mockResolvedValue({});

      await controller.findOne('member-1');

      // The organization comes from the authorized tenant context inside the
      // service; accepting one here would let a caller read another tenant.
      expect(mockService.getMemberOutstandingBalance).toHaveBeenCalledTimes(1);
      expect(mockService.getMemberOutstandingBalance.mock.calls[0]).toEqual(['member-1']);
    });

    it('guards the route with finance:read', () => {
      expect(permissionsFor(controller, 'findOne')).toEqual([
        { resource: 'finance', action: 'read' },
      ]);
    });
  });


  describe('FinancialReportsController', () => {
    let controller: FinancialReportsController;
    let mockService: { getRevenueSummary: jest.Mock; getOutstandingByStatus: jest.Mock };

    beforeEach(async () => {
      mockService = { getRevenueSummary: jest.fn(), getOutstandingByStatus: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [FinancialReportsController],
        providers: [{ provide: LedgerService, useValue: mockService }],
      }).compile();

      controller = module.get<FinancialReportsController>(FinancialReportsController);
    });

    it('delegates the revenue query to the ledger service', async () => {
      const query = { period: 'month' as const, from: '2026-01-01' };
      const summary = { organization_id: 'org-1', total_revenue: '100.00', buckets: [] };
      mockService.getRevenueSummary.mockResolvedValue(summary);

      await expect(controller.revenueSummary(query)).resolves.toEqual(summary);
      expect(mockService.getRevenueSummary).toHaveBeenCalledWith(query);
    });

    it('delegates the outstanding report with no arguments', async () => {
      const report = { organization_id: 'org-1', total_outstanding: '190.00', buckets: [] };
      mockService.getOutstandingByStatus.mockResolvedValue(report);

      await expect(controller.outstandingByStatus()).resolves.toEqual(report);
      expect(mockService.getOutstandingByStatus).toHaveBeenCalledWith();
    });

    it('guards both routes with the existing finance:read permission', () => {
      // No new RBAC permission was provisioned for P3-01, so a stray
      // finance:create/update here would lock the reports out for read-only roles.
      expect(permissionsFor(controller, 'revenueSummary')).toEqual([
        { resource: 'finance', action: 'read' },
      ]);
      expect(permissionsFor(controller, 'outstandingByStatus')).toEqual([
        { resource: 'finance', action: 'read' },
      ]);
    });
  });
});
