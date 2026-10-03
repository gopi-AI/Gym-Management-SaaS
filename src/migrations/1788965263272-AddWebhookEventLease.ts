import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DEF-05: gives `FINANCE_WEBHOOK_EVENTS` the two columns the processor needs to
 * re-claim rows orphaned by a crash, mirroring the outbox poller's lease
 * (`src/shared/outbox/outbox.entity.ts` — `attempts` + `lockedAt`).
 *
 * `locked_at` is the lease timestamp: the claim query takes only rows whose lease
 * is absent or expired, so a row whose claimant died is picked up again once the
 * lease lapses. `attempts` is the retry counter that bounds that recovery; at the
 * ceiling the row is parked.
 *
 * The outbox parks with a `dead_lettered` **boolean** because that table has no
 * status column. This one does (`status`, `1788965263260-…:14`), so parking is a
 * fifth status value instead of a parallel flag — one source of truth rather than
 * two (owner ruling, 2026-10-02). `status` is `character varying(20)`; the value
 * is 13 characters, so no widening is required.
 *
 * No index is added: the claim orders by `created_at` within `status IN
 * ('received','failed')`, which the existing
 * `IDX_finance_webhook_events_status_created` covers.
 */
export class AddWebhookEventLease1788965263272 implements MigrationInterface {
  name = 'AddWebhookEventLease1788965263272';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FINANCE_WEBHOOK_EVENTS" ADD "attempts" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "FINANCE_WEBHOOK_EVENTS" ADD "locked_at" TIMESTAMP WITH TIME ZONE`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "FINANCE_WEBHOOK_EVENTS" DROP COLUMN "locked_at"`);
    await queryRunner.query(`ALTER TABLE "FINANCE_WEBHOOK_EVENTS" DROP COLUMN "attempts"`);
  }
}
