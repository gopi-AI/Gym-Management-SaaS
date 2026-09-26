import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { PTEnrollment } from '../entities/pt-enrollment.entity';
import { TrainerCommission } from '../entities/trainer-commission.entity';
import { TrainerCommissionStatus } from '../entities/trainer-commission-status.enum';
import { CommissionPayoutRun } from '../entities/commission-payout-run.entity';
import { CommissionPayoutItem } from '../entities/commission-payout-item.entity';
import { CommissionPayoutsService } from './commission-payouts.service';
import { PT_EVENT_TYPES, PT_EVENT_VERSION } from '../pt.constants';

describe('CommissionPayoutsService', () => {
  const org = 'org-1';
  const runId = 'run-1';
  const commissionEarned = {
    id: 'commission-earned', organization_id: org, pt_enrollment_id: 'enrollment-1',
    trainer_id: 'trainer-1', amount: '125.00', currency: 'USD', status: TrainerCommissionStatus.EARNED,
    earned_at: new Date('2026-08-12T12:00:00.000Z'),
  } as TrainerCommission;
  const clawedBack = {
    id: 'commission-clawed', organization_id: org, pt_enrollment_id: 'enrollment-2',
    trainer_id: 'trainer-1', amount: '75.00', currency: 'USD', status: TrainerCommissionStatus.CLAWED_BACK,
    earned_at: new Date('2026-08-13T12:00:00.000Z'),
  } as TrainerCommission;
  let service: CommissionPayoutsService;
  let dataSource: { transaction: jest.Mock };
  let manager: { getRepository: jest.Mock };
  let query: Record<string, jest.Mock>;
  let runRepo: Record<string, jest.Mock>;
  let itemRepo: Record<string, jest.Mock>;
  let commissionRepo: Record<string, jest.Mock>;
  let outbox: { saveEventEnvelope: jest.Mock };
  let tenant: { getCurrentOrganizationId: jest.Mock; getRequestedOrganizationId: jest.Mock; requireOrganizationAccess: jest.Mock; getCurrentUserId: jest.Mock };
  let commissionsForScan: TrainerCommission[];

  beforeEach(async () => {
    commissionsForScan = [commissionEarned];
    query = {
      innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), getMany: jest.fn().mockImplementation(() => commissionsForScan),
    };
    runRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => ({ id: runId, ...value })),
      findOne: jest.fn().mockResolvedValue({ id: runId, organization_id: org, status: 'pending', currency: 'USD' }),
    };
    itemRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    commissionRepo = {
      createQueryBuilder: jest.fn(() => query),
      findOne: jest.fn().mockResolvedValue(commissionEarned),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    outbox = { saveEventEnvelope: jest.fn().mockResolvedValue({}) };
    tenant = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(org),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
      getCurrentUserId: jest.fn().mockResolvedValue('user-1'),
    };
    manager = {
      getRepository: jest.fn((target: unknown) => {
        if (target === CommissionPayoutRun) return runRepo;
        if (target === CommissionPayoutItem) return itemRepo;
        if (target === TrainerCommission) return commissionRepo;
        if (target === PTEnrollment) return {};
        return {};
      }),
    };
    dataSource = { transaction: jest.fn((cb: (tx: typeof manager) => unknown) => cb(manager)) };
    const module = await Test.createTestingModule({
      providers: [
        CommissionPayoutsService,
        { provide: getRepositoryToken(CommissionPayoutRun), useValue: runRepo },
        { provide: getRepositoryToken(CommissionPayoutItem), useValue: itemRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: TenantContextService, useValue: tenant },
        { provide: OutboxService, useValue: outbox },
      ],
    }).compile();
    service = module.get(CommissionPayoutsService);
  });

  it('snapshots only earned commissions in an org and date window, with explicit currency and no duplicate reservations', async () => {
    commissionsForScan = [commissionEarned, clawedBack];
    itemRepo.find.mockResolvedValue([{ trainer_commission_id: 'previously-reserved' }]);
    const run = await service.create({ period_start: '2026-08-01', period_end: '2026-08-31', currency: 'USD' });

    expect(query.where).toHaveBeenCalledWith('commission.organization_id = :org', { org });
    expect(query.andWhere).toHaveBeenCalledWith('commission.status = :earned', { earned: TrainerCommissionStatus.EARNED });
    expect(query.andWhere).toHaveBeenCalledWith('commission.earned_at >= :start', { start: new Date('2026-08-01T00:00:00.000Z') });
    expect(run.total_amount).toBe('125.00');
    expect(itemRepo.save).toHaveBeenCalledWith([expect.objectContaining({
      trainer_commission_id: commissionEarned.id, status: 'pending', amount: '125.00', currency: 'USD',
    })]);
    expect(run.organization_id).toBe(org);
  });

  it('rejects mixed currencies rather than combining unlike money values', async () => {
    commissionsForScan = [commissionEarned, { ...commissionEarned, id: 'commission-eur', currency: 'EUR' }];
    await expect(service.create({ period_start: '2026-08-01', period_end: '2026-08-31' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(runRepo.save).not.toHaveBeenCalled();
  });

  it('rechecks status under commission row lock and skips commissions clawed back after run creation', async () => {
    itemRepo.find.mockResolvedValue([{
      id: 'item-1', organization_id: org, payout_run_id: runId,
      trainer_commission_id: clawedBack.id, amount: clawedBack.amount, currency: 'USD', status: 'pending',
    }]);
    commissionRepo.findOne.mockResolvedValue(clawedBack);

    const run = await service.process(runId);

    expect(run.status).toBe('processed');
    expect(itemRepo.update).toHaveBeenCalledWith({ id: 'item-1', organization_id: org }, { status: 'skipped' });
    expect(commissionRepo.findOne).toHaveBeenCalledWith({
      where: { id: clawedBack.id, organization_id: org }, lock: { mode: 'pessimistic_write' },
    });
    expect(commissionRepo.update).not.toHaveBeenCalled();
    expect(outbox.saveEventEnvelope).not.toHaveBeenCalled();
    expect(run.total_amount).toBe('0.00');
  });

  it('marks earned commission paid with item payment fields and writes paid event atomically', async () => {
    itemRepo.find.mockResolvedValue([{
      id: 'item-2', organization_id: org, payout_run_id: runId,
      trainer_commission_id: commissionEarned.id, amount: commissionEarned.amount, currency: 'USD', status: 'pending',
    }]);
    commissionRepo.findOne.mockResolvedValue(commissionEarned);
    const run = await service.process(runId);

    expect(commissionRepo.update).toHaveBeenCalledWith(
      { id: commissionEarned.id, organization_id: org }, { status: TrainerCommissionStatus.PAID },
    );
    expect(itemRepo.update).toHaveBeenCalledWith({ id: 'item-2', organization_id: org }, {
      status: 'paid', paid_at: expect.any(Date), paid_amount: '125.00',
    });
    expect(outbox.saveEventEnvelope).toHaveBeenCalledWith(
      PT_EVENT_TYPES.TRAINER_COMMISSION_PAID, PT_EVENT_VERSION, org,
      expect.objectContaining({ commissionId: commissionEarned.id, payoutRunId: runId, amount: '125.00', currency: 'USD' }),
      runId, undefined, manager,
    );
    expect(run.total_amount).toBe('125.00');
    expect(run.processed_at).toEqual(expect.any(Date));
  });

  it('scopes run reads and rejects a run from another organization', async () => {
    runRepo.findOne.mockResolvedValue(null);
    await expect(service.process('foreign-run')).rejects.toBeInstanceOf(NotFoundException);
    expect(runRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'foreign-run', organization_id: org },
    }));
  });

  it('does not process the same payout run twice', async () => {
    runRepo.findOne.mockResolvedValue({ id: runId, organization_id: org, status: 'processed' });
    await expect(service.process(runId)).rejects.toBeInstanceOf(ConflictException);
    expect(itemRepo.find).not.toHaveBeenCalled();
  });

  it('maps a create() race lost to the payout-item unique index to a 409, not a raw database error', async () => {
    // Both creates pass the reservation check: the shared find sees nothing yet.
    // The second INSERT is then refused by UQ_pt_payout_items_org_commission,
    // exactly as Postgres decides the race.
    let itemSaveCalls = 0;
    itemRepo.save.mockImplementation(async (value) => {
      itemSaveCalls += 1;
      if (itemSaveCalls > 1) throw { driverError: { code: '23505' } };
      return value;
    });

    const results = await Promise.allSettled([
      service.create({ period_start: '2026-08-01', period_end: '2026-08-31', currency: 'USD' }),
      service.create({ period_start: '2026-08-01', period_end: '2026-08-31', currency: 'USD' }),
    ]);

    // Both reached the insert, i.e. the belt check missed the race entirely ...
    expect(itemSaveCalls).toBe(2);
    // ... and exactly one run survived, the loser reporting a retryable 409.
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect((rejected[0].reason as Error).message).toBe(
      'One or more commissions in this period were already reserved by a concurrent payout run — retry the run',
    );
  });

  it('leaves a non-unique database failure untouched rather than relabelling it a 409', async () => {
    const foreignKeyViolation = { code: '23503', message: 'insert or update on table violates foreign key constraint' };
    itemRepo.save.mockRejectedValue(foreignKeyViolation);

    const rejection = await service.create({
      period_start: '2026-08-01', period_end: '2026-08-31', currency: 'USD',
    }).catch((error: unknown) => error);

    expect(rejection).toBe(foreignKeyViolation);
    expect(rejection).not.toBeInstanceOf(ConflictException);
  });
});