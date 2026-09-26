import * as fs from 'fs';
import * as path from 'path';
import { ProvisionPtPayoutPermission1788965263271 } from '../1788965263271-ProvisionPtPayoutPermission';

describe('ProvisionPtPayoutPermission migration', () => {
  it('uses its own migration and provisions the dedicated pt:payout authority idempotently', async () => {
    const migration = new ProvisionPtPayoutPermission1788965263271();
    const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
    const runner = {
      query: jest.fn(async (sql: string, parameters?: unknown[]) => {
        calls.push({ sql, parameters });
        if (sql.includes('SELECT "id" FROM "IDENTITY_ROLES"')) return [{ id: 'owner-role' }];
        if (sql.includes('SELECT "id" FROM "IDENTITY_PERMISSIONS"')) return [];
        if (sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"')) return [{ id: 'permission-payout' }];
        return [];
      }),
    };

    await migration.up(runner as never);

    expect(migration.name).toBe('ProvisionPtPayoutPermission1788965263271');
    expect(calls.find((call) => call.sql.includes('INSERT INTO "IDENTITY_PERMISSIONS"'))?.parameters)
      .toEqual(['pt:payout', 'Create and process trainer commission payout runs', 'pt', 'payout']);
    expect(calls.some((call) => call.sql.includes('INSERT INTO "IDENTITY_ROLE_PERMISSIONS"') && call.sql.includes('NOT EXISTS'))).toBe(true);
  });

  it('is registered as a concrete migration class, never as a top-level function export', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '1788965263271-ProvisionPtPayoutPermission.ts'), 'utf8');
    expect(source).toMatch(/export class ProvisionPtPayoutPermission1788965263271/);
    expect(source).not.toMatch(/^export function /m);
  });
});