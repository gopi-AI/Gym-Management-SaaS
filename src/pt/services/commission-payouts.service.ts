import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { TrainerCommission } from '../entities/trainer-commission.entity';
import { TrainerCommissionStatus } from '../entities/trainer-commission-status.enum';
import { CommissionPayoutRun } from '../entities/commission-payout-run.entity';
import { CommissionPayoutItem } from '../entities/commission-payout-item.entity';
import { CreateCommissionPayoutDto } from '../dto/create-commission-payout.dto';
import { PT_EVENT_TYPES, PT_EVENT_VERSION } from '../pt.constants';

@Injectable()
export class CommissionPayoutsService {
  constructor(
    @InjectRepository(CommissionPayoutRun) private readonly runRepository: Repository<CommissionPayoutRun>,
    @InjectRepository(CommissionPayoutItem) private readonly itemRepository: Repository<CommissionPayoutItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly outbox: OutboxService,
  ) {}

  private async organizationId(): Promise<string> {
    const current = await this.tenantContext.getCurrentOrganizationId();
    if (current) return current;
    const requested = await this.tenantContext.getRequestedOrganizationId();
    if (!requested) throw new ForbiddenException('Organization context required');
    return this.tenantContext.requireOrganizationAccess(requested);
  }

  async create(dto: CreateCommissionPayoutDto): Promise<CommissionPayoutRun> {
    const org = await this.organizationId();
    if (dto.period_end < dto.period_start) throw new BadRequestException('period_end must be on or after period_start');
    const creator = await this.tenantContext.getCurrentUserId();
    return this.dataSource.transaction(async (manager) => {
      const endExclusive = new Date(`${dto.period_end}T00:00:00.000Z`);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      const commissionRepo = manager.getRepository(TrainerCommission);
      const commissions = await commissionRepo.createQueryBuilder('commission')
        .where('commission.organization_id = :org', { org })
        .andWhere('commission.status = :earned', { earned: TrainerCommissionStatus.EARNED })
        .andWhere('commission.earned_at >= :start', { start: new Date(`${dto.period_start}T00:00:00.000Z`) })
        .andWhere('commission.earned_at < :end', { end: endExclusive })
        .orderBy('commission.earned_at', 'ASC')
        .getMany();
      const currencies = [...new Set(commissions.map((commission) => commission.currency))];
      if (!dto.currency && currencies.length > 1) {
        throw new BadRequestException('Payout period includes multiple currencies; create separate runs with currency');
      }
      const currency = (dto.currency ?? currencies[0] ?? '').toUpperCase();
      if (!currency) throw new BadRequestException('currency is required when no earned commissions exist in the period');
      const currencyCommissions = commissions.filter((commission) =>
        commission.status === TrainerCommissionStatus.EARNED && commission.currency === currency,
      );
      const reserved = currencyCommissions.length ? await manager.getRepository(CommissionPayoutItem).find({
        where: { organization_id: org },
      }) : [];
      const reservedIds = new Set(reserved.map((item) => item.trainer_commission_id));
      const eligible = currencyCommissions.filter((commission) => !reservedIds.has(commission.id));
      for (const commission of eligible) {
        const locked = await commissionRepo.findOne({
          where: { id: commission.id, organization_id: org },
          lock: { mode: 'pessimistic_write' },
        });
        // create() is all-or-nothing by design: a snapshot that silently dropped
        // a commission would understate the run, so changed eligibility aborts
        // the run and the operator retries. process() is deliberately tolerant
        // instead, marking stale items skipped rather than failing the whole run.
        if (!locked || locked.status !== TrainerCommissionStatus.EARNED) {
          throw new ConflictException('Commission eligibility changed while creating payout run; retry the run');
        }
      }
      const totalCents = eligible.reduce((sum, commission) => sum + Math.round(Number(commission.amount) * 100), 0);
      const runRepo = manager.getRepository(CommissionPayoutRun);
      const run = await runRepo.save(runRepo.create({
        organization_id: org,
        period_start: dto.period_start,
        period_end: dto.period_end,
        status: 'pending',
        total_amount: (totalCents / 100).toFixed(2),
        currency,
        created_by: creator ?? null,
      }));
      const itemRepo = manager.getRepository(CommissionPayoutItem);
      if (eligible.length) await itemRepo.save(eligible.map((commission) => itemRepo.create({
        organization_id: org,
        payout_run_id: run.id,
        trainer_commission_id: commission.id,
        trainer_id: commission.trainer_id,
        amount: commission.amount,
        currency: commission.currency,
        status: 'pending',
        paid_at: null,
        paid_amount: null,
      })));
      return run;
    });
  }

  async process(id: string): Promise<CommissionPayoutRun> {
    const org = await this.organizationId();
    return this.dataSource.transaction(async (manager) => {
      const runs = manager.getRepository(CommissionPayoutRun);
      const run = await runs.findOne({ where: { id, organization_id: org }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new NotFoundException('Commission payout run not found');
      if (run.status !== 'pending') throw new ConflictException('Commission payout run is not pending');
      const itemRepo = manager.getRepository(CommissionPayoutItem);
      const items = await itemRepo.find({ where: { payout_run_id: id, organization_id: org } });
      const commissionRepo = manager.getRepository(TrainerCommission);
      const paidAt = new Date();
      let paidTotalCents = 0;
      for (const item of items) {
        const commission = await commissionRepo.findOne({
          where: { id: item.trainer_commission_id, organization_id: org },
          lock: { mode: 'pessimistic_write' },
        });
        // P3-11 clawbacks win over payout snapshots. Stale clawed-back items are
        // marked skipped, and no paid status or event is written for them.
        if (!commission || commission.status !== TrainerCommissionStatus.EARNED) {
          await itemRepo.update({ id: item.id, organization_id: org }, { status: 'skipped' });
          continue;
        }
        await commissionRepo.update({ id: commission.id, organization_id: org }, { status: TrainerCommissionStatus.PAID });
        await itemRepo.update({ id: item.id, organization_id: org }, {
          status: 'paid', paid_at: paidAt, paid_amount: commission.amount,
        });
        paidTotalCents += Math.round(Number(commission.amount) * 100);
        await this.outbox.saveEventEnvelope(PT_EVENT_TYPES.TRAINER_COMMISSION_PAID, PT_EVENT_VERSION, org, {
          commissionId: commission.id,
          payoutRunId: run.id,
          trainerId: commission.trainer_id,
          organizationId: org,
          amount: commission.amount,
          currency: commission.currency,
          paidAt: paidAt.toISOString(),
        }, run.id, undefined, manager);
      }
      run.status = 'processed';
      run.total_amount = (paidTotalCents / 100).toFixed(2);
      run.processed_at = paidAt;
      return runs.save(run);
    });
  }

  async findOne(id: string): Promise<CommissionPayoutRun & { items: CommissionPayoutItem[] }> {
    const org = await this.organizationId();
    const run = await this.runRepository.findOne({ where: { id, organization_id: org } });
    if (!run) throw new NotFoundException('Commission payout run not found');
    const items = await this.itemRepository.find({ where: { payout_run_id: id, organization_id: org } });
    return Object.assign(run, { items });
  }
}