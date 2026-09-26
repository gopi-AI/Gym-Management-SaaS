import { CreatePtCommissionPayoutTables1788965263270 } from '../1788965263270-CreatePtCommissionPayoutTables';

describe('CreatePtCommissionPayoutTables migration', () => {
  it('creates the run/item pair with org and unique commission guards without changing commission columns', async () => {
    const migration = new CreatePtCommissionPayoutTables1788965263270();
    const statements: string[] = [];
    const queryRunner = { query: jest.fn(async (sql: string) => { statements.push(sql); }) };

    await migration.up(queryRunner as never);

    expect(migration.name).toBe('CreatePtCommissionPayoutTables1788965263270');
    expect(statements.some((sql) => sql.includes('CREATE TABLE "PT_COMMISSION_PAYOUT_RUNS"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE "PT_COMMISSION_PAYOUT_ITEMS"') && sql.includes('"paid_at"') && sql.includes('"paid_amount"'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UQ_pt_payout_items_org_commission'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ALTER TABLE "PT_TRAINER_COMMISSIONS"'))).toBe(false);
  });
});