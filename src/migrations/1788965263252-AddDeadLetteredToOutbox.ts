import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add dead_lettered column to shared.outbox.
 *
 * When an outbox row exceeds the max-attempts ceiling (currently 10), it is
 * flagged as dead-lettered and excluded from future claimNextBatch queries so
 * legacy payloads (written by saveEvent before saveEventEnvelope existed) stop
 * retrying forever. This is a safety ceiling — no existing data is changed.
 */
export class AddDeadLetteredToOutbox1788965263252 implements MigrationInterface {
    name = 'AddDeadLetteredToOutbox1788965263252'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "shared"."outbox"
            ADD COLUMN "deadLettered" boolean NOT NULL DEFAULT false;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "shared"."outbox"
            DROP COLUMN "deadLettered";
        `);
    }
}