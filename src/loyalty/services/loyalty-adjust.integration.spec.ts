/**
 * P2-08 — real-Postgres proof for the manual loyalty adjustment write path.
 *
 * What this covers that the hermetic specs cannot:
 *   1. The partial unique index `UQ_loyalty_admin_adjust_key` exists and rejects
 *      a second `(account_id, 'admin_adjust', reference_id)` row (SQLSTATE 23505).
 *   2. Two concurrent requests with the SAME idempotency key serialize on the
 *      account row lock, and exactly one ledger row is written.
 *   3. Two concurrent debits that would jointly overdraw cannot take the balance
 *      negative: one succeeds, the other gets a 409 ConflictException.
 *   4. The materialized balance reconciles against the ledger movements,
 *      asserted by a second read (not by trusting the service's return value).
 *   5. `created_by` is persisted for the actor.
 *
 * RUNNING IT — same pattern as the memberships integration specs:
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/loyalty/services/loyalty-adjust.integration.spec
 * The database MUST already be migrated. Point it at a THROWAWAY database:
 * every row it writes belongs to one freshly generated organization and member,
 * and is deleted in `afterEach`/`afterAll` (the outbox rows are deleted first
 * because the ledger rows cascade with the account).
 *
 * Without `RUN_DB_INTEGRATION=1` the block reports as SKIPPED, so the hermetic
 * suite never needs a database.
 */
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LoyaltyAdjustService } from './loyalty-adjust.service';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration('LoyaltyAdjustService (real Postgres, concurrent)', () => {
  let dataSource: DataSource;
  let service: LoyaltyAdjustService;
  let accountRepository: Repository<LoyaltyAccount>;
  let transactionRepository: Repository<LoyaltyTransaction>;

  const organizationId = randomUUID();
  let memberId: string;
  let accountId: string;

  const STARTING_BALANCE = 100;
  const ACTOR = '00000000-0000-4000-8000-000000000009';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    accountRepository = dataSource.getRepository(LoyaltyAccount);
    transactionRepository = dataSource.getRepository(LoyaltyTransaction);

    // `LoyaltyAdjustService` only reaches the repositories it is handed, the
    // DataSource and the outbox. The tenant context is the one collaborator
    // that has no real request behind it here, so it is a stub returning the
    // fixture org.
    const tenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(organizationId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn().mockResolvedValue(organizationId),
    };

    service = new LoyaltyAdjustService(
      accountRepository,
      transactionRepository,
      dataSource,
      tenantContext as unknown as TenantContextService,
      new OutboxService(dataSource.getRepository(OutboxEntity)),
    );
  });

  beforeEach(async () => {
    // A fresh member per test keeps the (org, member) unique index satisfied and
    // isolates each test's balance.
    memberId = randomUUID();
    accountId = randomUUID();
    await accountRepository.save(
      accountRepository.create({
        id: accountId,
        organization_id: organizationId,
        member_id: memberId,
        balance: STARTING_BALANCE,
        lifetime_points_earned: STARTING_BALANCE,
        lifetime_points_redeemed: 0,
        tier: null,
      }),
    );
  });

  afterEach(async () => {
    const transactions = await transactionRepository.find({
      where: { account_id: accountId },
    });
    const correlationIds = transactions.map((txn) => txn.id);
    if (correlationIds.length > 0) {
      await dataSource.query(
        `DELETE FROM shared.outbox WHERE "correlationId" = ANY($1)`,
        [correlationIds],
      );
    }
    await accountRepository.delete({ id: accountId });
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function dto(points: number, key: string) {
    return { points, reason: `Integration ${key}`, idempotency_key: key };
  }

  async function readBalance(): Promise<number> {
    const [row] = await dataSource.query(
      `SELECT "balance" FROM "LOYALTY_ACCOUNTS" WHERE "id" = $1`,
      [accountId],
    );
    return row.balance as number;
  }

  it('writes exactly one ledger row for two concurrent requests with the same idempotency key', async () => {
    const key = `same-${randomUUID()}`;

    const results = await Promise.all([
      service.adjust(memberId, dto(25, key), ACTOR),
      service.adjust(memberId, dto(25, key), ACTOR),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);

    const rows = await transactionRepository.find({
      where: { account_id: accountId, reference_id: key },
    });
    expect(rows).toHaveLength(1);
    expect(await readBalance()).toBe(STARTING_BALANCE + 25);
  });

  it('cannot jointly overdraw the balance: one debit wins, the other is a 409', async () => {
    const results = await Promise.allSettled([
      service.adjust(memberId, dto(-80, `overdraw-a-${randomUUID()}`), ACTOR),
      service.adjust(memberId, dto(-80, `overdraw-b-${randomUUID()}`), ACTOR),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );

    const balance = await readBalance();
    expect(balance).toBe(STARTING_BALANCE - 80);
    expect(balance).toBeGreaterThanOrEqual(0);

    const adjustRows = await transactionRepository.find({
      where: { account_id: accountId, transaction_type: 'adjust' },
    });
    expect(adjustRows).toHaveLength(1);
  });

  it('reconciles the materialized balance against the ledger through a second read', async () => {
    await service.adjust(memberId, dto(40, `recon-a-${randomUUID()}`), ACTOR);
    await service.adjust(memberId, dto(-15, `recon-b-${randomUUID()}`), ACTOR);

    const [row] = await dataSource.query(
      `SELECT "balance" FROM "LOYALTY_ACCOUNTS" WHERE "id" = $1`,
      [accountId],
    );
    const [sum] = await dataSource.query(
      `SELECT COALESCE(SUM(
          CASE
            WHEN "transaction_type" = 'adjust' AND "remaining_points" > 0 THEN "points"
            WHEN "transaction_type" = 'adjust' THEN -"points"
            ELSE 0
          END
       ), 0)::int AS delta
       FROM "LOYALTY_TRANSACTIONS"
       WHERE "account_id" = $1`,
      [accountId],
    );

    // +40 then -15 nets +25 against the starting balance.
    expect(sum.delta).toBe(25);
    expect(row.balance).toBe(STARTING_BALANCE + sum.delta);
    expect(row.balance).toBe(STARTING_BALANCE + 25);
  });

  it('persists the actor in created_by', async () => {
    const key = `actor-${randomUUID()}`;
    await service.adjust(memberId, dto(5, key), ACTOR);

    const [row] = await dataSource.query(
      `SELECT "created_by" FROM "LOYALTY_TRANSACTIONS"
       WHERE "account_id" = $1 AND "reference_id" = $2`,
      [accountId, key],
    );
    expect(row.created_by).toBe(ACTOR);
  });

  it('the partial unique index rejects a second admin_adjust row for the same key', async () => {
    const key = `index-${randomUUID()}`;
    await service.adjust(memberId, dto(5, key), ACTOR);

    const duplicate = transactionRepository.create({
      account_id: accountId,
      transaction_type: 'adjust',
      points: 5,
      remaining_points: 5,
      reference_type: 'admin_adjust',
      reference_id: key,
      description: 'direct duplicate',
      expires_at: null,
      created_by: ACTOR,
    });

    await expect(transactionRepository.save(duplicate)).rejects.toMatchObject({
      code: '23505',
    });
  });
});
