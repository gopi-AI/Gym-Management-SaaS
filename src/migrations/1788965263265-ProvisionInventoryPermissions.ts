import { MigrationInterface, QueryRunner } from 'typeorm';

export const INVENTORY_PERMISSIONS = [
  ['inventory:read', 'Read inventory', 'read'],
  ['inventory:create', 'Create inventory records', 'create'],
  ['inventory:update', 'Update inventory records', 'update'],
  ['inventory:receive', 'Receive purchase orders into inventory', 'receive'],
] as const;

export class ProvisionInventoryPermissions1788965263265 implements MigrationInterface {
  name = 'ProvisionInventoryPermissions1788965263265';
  public async up(q: QueryRunner): Promise<void> {
    const roles = await q.query(`SELECT "id" FROM "IDENTITY_ROLES" WHERE "name"=$1 ORDER BY "created_at" ASC LIMIT 1`, ['owner']);
    const role = roles[0] ?? (await q.query(`INSERT INTO "IDENTITY_ROLES" ("name","description","is_active") VALUES ($1,$2,true) RETURNING "id"`, ['owner','Owner role']))[0];
    for (const [name, description, action] of INVENTORY_PERMISSIONS) {
      const rows = await q.query(`SELECT "id" FROM "IDENTITY_PERMISSIONS" WHERE "resource"=$1 AND "action"=$2 ORDER BY "created_at" ASC LIMIT 1`, ['inventory', action]);
      const permission = rows[0] ?? (await q.query(`INSERT INTO "IDENTITY_PERMISSIONS" ("name","description","resource","action","is_active") VALUES ($1,$2,$3,$4,true) RETURNING "id"`, [name,description,'inventory',action]))[0];
      const link = await q.query(`SELECT "id" FROM "IDENTITY_ROLE_PERMISSIONS" WHERE "role_id"=$1 AND "permission_id"=$2 LIMIT 1`, [role.id, permission.id]);
      if (!link.length) await q.query(`INSERT INTO "IDENTITY_ROLE_PERMISSIONS" ("role_id","permission_id") VALUES ($1,$2)`, [role.id, permission.id]);
    }
  }
  public async down(q: QueryRunner): Promise<void> {
    for (const [, , action] of INVENTORY_PERMISSIONS) {
      await q.query(`DELETE FROM "IDENTITY_ROLE_PERMISSIONS" rp USING "IDENTITY_ROLES" r,"IDENTITY_PERMISSIONS" p WHERE rp."role_id"=r."id" AND rp."permission_id"=p."id" AND r."name"=$1 AND p."resource"=$2 AND p."action"=$3`, ['owner','inventory',action]);
      await q.query(`DELETE FROM "IDENTITY_PERMISSIONS" WHERE "resource"=$1 AND "action"=$2`, ['inventory',action]);
    }
  }
}