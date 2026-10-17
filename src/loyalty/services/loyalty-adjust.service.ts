import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { AdjustLoyaltyPointsDto } from '../dto/adjust-loyalty-points.dto';
import {
  LOYALTY_EVENT_TYPES,
  LOYALTY_EVENT_VERSION,
  LOYALTY_REFERENCE_TYPES,
  LOYALTY_TRANSACTION_TYPES,
} from '../loyalty.constants';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

export interface AdjustLoyaltyPointsResult {
  transaction: LoyaltyTransaction;
  /** Account balance after the adjustment (or the current balance on replay). */
  balance: number;
  /** False when an existing transaction was replayed for the same idempotency key. */
  created: boolean;
}

/**
 * Single legal write path for manual loyalty-point adjustments (P2-08).
 *
 * One transaction does all of the following, in order:
 *   1. Resolve the organization from the tenant context — never from the body.
 *   2. Lock the member's `LOYALTY_ACCOUNTS` row (`SELECT ... FOR UPDATE`); 404 if
 *      the member has no account (the read route behaves the same way).
 *   3. Replay check: an existing `(account_id, reference_type='admin_adjust',
 *      reference_id=idempotency_key)` row is returned as-is, with no write.
 *   4. Reject a debit that would take the balance below zero (409).
 *   5. Insert the append-only `adjust` ledger row with the actor in `created_by`.
 *   6. Update `balance` with a SQL-level `increment`/`decrement` (never a
 *      read-modify-write); the lifetime counters are deliberately untouched —
 *      they track trigger-based earn and reward redemption only.
 *   7. Emit `LoyaltyPointsAdjusted.v1` through the outbox on the SAME
 *      transaction manager, so the event cannot survive a rolled-back write.
 *
 * The account row lock serializes concurrent adjustments for one member, which
 * makes the replay read and the non-negative guard safe under concurrency. The
 * partial unique index `UQ_loyalty_admin_adjust_key` (migration
 * `AddLoyaltyAdjustIdempotencyAndActor1792195200001`) is the DB-level backstop.
 */
@Injectable()
export class LoyaltyAdjustService {
  constructor(
    @InjectRepository(LoyaltyAccount)
    private readonly accountRepository: Repository<LoyaltyAccount>,
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionRepository: Repository<LoyaltyTransaction>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId =
      await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId =
      await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  async adjust(
    memberId: string,
    dto: AdjustLoyaltyPointsDto,
    actorUserId: string | null,
  ): Promise<AdjustLoyaltyPointsResult> {
    const organizationId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      const accountRepo = manager.getRepository(LoyaltyAccount);
      const transactionRepo = manager.getRepository(LoyaltyTransaction);

      const account = await accountRepo.findOne({
        where: { organization_id: organizationId, member_id: memberId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException('Loyalty account not found');
      }

      const existing = await transactionRepo.findOne({
        where: {
          account_id: account.id,
          reference_type: LOYALTY_REFERENCE_TYPES.ADMIN_ADJUST,
          reference_id: dto.idempotency_key,
        },
      });
      if (existing) {
        return {
          transaction: existing,
          balance: account.balance,
          created: false,
        };
      }

      if (dto.points < 0 && account.balance + dto.points < 0) {
        throw new ConflictException(
          'Adjustment would take the loyalty balance below zero',
        );
      }

      const transaction = transactionRepo.create({
        account_id: account.id,
        transaction_type: LOYALTY_TRANSACTION_TYPES.ADJUST,
        points: Math.abs(dto.points),
        remaining_points: dto.points > 0 ? dto.points : 0,
        reference_type: LOYALTY_REFERENCE_TYPES.ADMIN_ADJUST,
        reference_id: dto.idempotency_key,
        description: dto.reason,
        // Adjustments never expire — matches the entity convention ("Null for
        // expire/redeem/adjust").
        expires_at: null,
        created_by: actorUserId,
      });
      const saved = await transactionRepo.save(transaction);

      // SQL-level arithmetic, never a read-modify-write; org-scoped so a row
      // cannot be moved across tenants between the lock and the update.
      if (dto.points > 0) {
        await accountRepo.increment(
          { id: account.id, organization_id: organizationId },
          'balance',
          dto.points,
        );
      } else {
        await accountRepo.decrement(
          { id: account.id, organization_id: organizationId },
          'balance',
          Math.abs(dto.points),
        );
      }

      const balanceAfter = account.balance + dto.points;

      await this.outboxService.saveEventEnvelope(
        LOYALTY_EVENT_TYPES.LOYALTY_POINTS_ADJUSTED,
        LOYALTY_EVENT_VERSION,
        organizationId,
        {
          accountId: account.id,
          memberId,
          transactionId: saved.id,
          points: dto.points,
          balanceAfter,
          reason: dto.reason,
          adjustedBy: actorUserId,
        },
        saved.id,
        undefined,
        manager,
      );

      return { transaction: saved, balance: balanceAfter, created: true };
    });
  }
}
