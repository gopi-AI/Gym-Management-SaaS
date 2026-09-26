import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the independent, payroll-sensitive permission for P3-12. */
export class ProvisionPtPayoutPermission1788965263271 implements MigrationInterface {
  name = 'ProvisionPtPayoutPermission1788965263271';

  async up(queryRunner: QueryRunner): Promise<void> {
    const roles = await queryRunner.query(`SELECT "id" FROM "IDENTITY_ROLES" WHERE "name" = $1 ORDER BY "created_at" ASC LIMIT 1`, ['owner']);
    if (!roles.length) throw new Error('Owner role must be provisioned before pt:payout');
    const rows = await queryRunner.query(`SELECT "id" FROM "IDENTITY_PERMISSIONS" WHERE "resource" = $1 AND "action" = $2 ORDER BY "created_at" ASC LIMIT 1`, ['pt', 'payout']);
    const permission = rows[0] ?? (await queryRunner.query(
      `INSERT INTO "IDENTITY_PERMISSIONS" ("name", "description", "resource", "action", "is_active") VALUES ($1,$2,$3,$4,true) RETURNING "id"`,
      ['pt:payout', 'Create and process trainer commission payout runs', 'pt', 'payout'],
    ))[0];
    await queryRunner.query(
      `INSERT INTO "IDENTITY_ROLE_PERMISSIONS" ("role_id", "permission_id") SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM "IDENTITY_ROLE_PERMISSIONS" WHERE "role_id"=$1 AND "permission_id"=$2)`,
      [roles[0].id, permission.id],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp USING "IDENTITY_ROLES" r, "IDENTITY_PERMISSIONS" p WHERE rp."role_id"=r."id" AND rp."permission_id"=p."id" AND r."name"=$1 AND p."resource"=$2 AND p."action"=$3`, ['owner', 'pt', 'payout']);
    await queryRunner.query(`DELETE FROM "IDENTITY_PERMISSIONS" WHERE "resource"=$1 AND "action"=$2`, ['pt', 'payout']);
  }
}