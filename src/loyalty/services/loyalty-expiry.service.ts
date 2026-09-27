import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { OutboxService } from '../../shared/outbox/outbox.service';
import {
  LOYALTY_TRANSACTION_TYPES,
  LOYALTY_REFERENCE_TYPES,
  LOYALTY_EVENT_TYPES,
  LOYALTY_EVENT_VERSION,
  DEFAULT_POINTS_EXPIRY_DAYS,
} from '../loyalty.constants';

/**
 * Expiry-sweep worker — scans for expired points and writes expire transactions.
 *
 * Runs as a cron-like background worker (see BackgroundWorker) every N hours.
 * Each tick processes a batch of expired LoyaltyTransaction rows and, for each
 * row with remaining_points > 0 and expires_at <= now, creates an `expire`
 * transaction that decrements the account balance.
 *
 * This is the ONLY purpose of the tier column checks in §12 Q19 — any tier-based
 * logic that defers expiry is NOT built in Phase 2.
 *
 * Per §12 Q22: "Batch expiry-sweep worker (cron-like) that marks points as
 * expired and deducts them from the account balance."
 */
@Injectable()
export class LoyaltyExpiryService {
  private readonly logger = new Logger(LoyaltyExpiryService.name);

  constructor(
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionRepository: Repository<LoyaltyTransaction>,
    @InjectRepository(LoyaltyAccount)
    private readonly accountRepository: Repository<LoyaltyAccount>,
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * Run one sweep tick: process all expired earn transactions up to a limit.
   *
   * Returns the number of expired rows processed (0 = no work).
   * This method is safe to call repeatedly from a background worker tick.
   */
  async sweepExpiredTransactions(batchSize = 200): Promise<number> {
    const now = new Date();

    const expired = await this.transactionRepository
      .createQueryBuilder('txn')
      .where('txn.expires_at IS NOT NULL')
      .andWhere('txn.expires_at <= :now', { now })
      .andWhere('txn.remaining_points > 0')
      .orderBy('txn.expires_at', 'ASC')
      .limit(batchSize)
      .getMany();

    if (expired.length === 0) {
      return 0;
    }

    let processed = 0;

    for (const txn of expired) {
      try {
        await this.expireTransaction(txn, now);
        processed++;
      } catch (error) {
        this.logger.error(
          `Failed to expire transaction ${txn.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return processed;
  }

  private async expireTransaction(
    earnTxn: LoyaltyTransaction,
    now: Date,
  ): Promise<void> {
    const pointsToExpire = earnTxn.remaining_points;

    await this.transactionRepository.manager.transaction(async (manager) => {
      // 1. Fetch the account to get the organization_id for the event envelope and
      //    for the expire row's own organization_id (NOT NULL since
      //    1788965263403-AddOrganizationIdToLoyaltyTransactions.ts). The column is
      //    guaranteed non-null by LOYALTY_TRANSACTIONS.account_id's FK.
      const account = await manager.getRepository(LoyaltyAccount).findOne({
        where: { id: earnTxn.account_id },
      });
      const organizationId = account?.organization_id ?? '';

      // 2. Zero out the remaining_points on the earn transaction.
      await manager.getRepository(LoyaltyTransaction).update(
        { id: earnTxn.id },
        { remaining_points: 0 },
      );

      // 3. Write the expire transaction.
      const expireTxn = manager.getRepository(LoyaltyTransaction).create({
        account_id: earnTxn.account_id,
        organization_id: organizationId,
        transaction_type: LOYALTY_TRANSACTION_TYPES.EXPIRE,
        points: pointsToExpire,
        remaining_points: 0,
        reference_type: LOYALTY_REFERENCE_TYPES.EXPIRY_SWEEP,
        reference_id: earnTxn.id,
        description: `Points expired from transaction ${earnTxn.id}`,
        expires_at: null,
      });
      const savedExpireTxn = await manager.getRepository(LoyaltyTransaction).save(expireTxn);

      // 4. Decrement the account balance.
      await manager.getRepository(LoyaltyAccount).decrement(
        { id: earnTxn.account_id },
        'balance',
        pointsToExpire,
      );

      // 5. Emit the LoyaltyPointsExpired.v1 event via the outbox.
      await this.outboxService.saveEventEnvelope(
        LOYALTY_EVENT_TYPES.LOYALTY_POINTS_EXPIRED,
        LOYALTY_EVENT_VERSION,
        organizationId,
        {
          accountId: earnTxn.account_id,
          transactionId: earnTxn.id,
          expireTransactionId: savedExpireTxn.id,
          pointsExpired: pointsToExpire,
        },
        savedExpireTxn.id,
        undefined,
        manager,
      );
    });
  }
}