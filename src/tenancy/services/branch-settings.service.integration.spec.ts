/**
 * Real-DB integration test for BranchSettingsService upsert semantics (Fix 2).
 *
 * WHY THIS EXISTS ALONGSIDE THE MOCKED SPEC
 * The mocked spec in branch-settings.controller.spec.ts uses an in-memory Map
 * to track rows, but it cannot verify that TypeORM's save() actually performs
 * an UPDATE (carrying the previous row's id) rather than an INSERT. Only a
 * real database round-trip can confirm the UNIQUE INDEX on (branch_id,
 * organization_id) is respected and the service correctly carries the id.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/tenancy/services/branch-settings.service.integration
 * The database MUST already be migrated with the same variables exported:
 *   DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *   DB_DATABASE=<scratch> npm run migration:run
 * Jest does not load `.env`, so pass all five explicitly. Without
 * `RUN_DB_INTEGRATION=1` the block reports as SKIPPED, so the hermetic
 * `npm test` never needs a database.
 *
 * Point it at a THROWAWAY database. Every row it writes belongs to one of two
 * freshly generated organizations and is deleted in `afterAll`, but the clean-up
 * is a courtesy, not a substitute for an isolated schema.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { BranchSettingsService } from './branch-settings.service';
import { BranchSettings } from '../entities/branch-settings.entity';
import { Branch } from '../entities/branch.entity';
import { TenantSettings } from '../entities/tenant-settings.entity';
import { Organization } from '../entities/organization.entity';
import { UpdateBranchSettingsDto } from '../dto/update-branch-settings.dto';
import { AppDataSource } from '../../data-source';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration('BranchSettingsService upsert semantics (real DB)', () => {
  let ds: DataSource;
  let service: BranchSettingsService;
  let orgId: string;
  let branchId: string;
  let otherOrgId: string;
  let otherBranchId: string;

  beforeAll(async () => {
    ds = await AppDataSource.initialize();
    service = new BranchSettingsService(
      ds.getRepository(Branch),
      ds.getRepository(BranchSettings),
      ds.getRepository(require('../entities/branch-settings-history.entity').BranchSettingsHistory),
      ds.getRepository(TenantSettings),
    );

    // Create two organizations and branches for isolation testing
    orgId = randomUUID();
    otherOrgId = randomUUID();
    branchId = randomUUID();
    otherBranchId = randomUUID();

    await ds.getRepository(Organization).save([
      { id: orgId, name: 'Test Org A', slug: 'test-org-a', is_active: true },
      { id: otherOrgId, name: 'Test Org B', slug: 'test-org-b', is_active: true },
    ]);

    await ds.getRepository(Branch).save([
      { id: branchId, organization_id: orgId, name: 'Branch A', is_active: true },
      { id: otherBranchId, organization_id: otherOrgId, name: 'Branch B', is_active: true },
    ]);

    // Set org-level tenant settings for fallback
    await ds.getRepository(TenantSettings).save({
      organization_id: orgId,
      time_zone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    await ds.getRepository(TenantSettings).save({
      organization_id: otherOrgId,
      time_zone: 'America/New_York',
      locale: 'en-GB',
      currency: 'GBP',
    });
  });

  afterAll(async () => {
    if (ds?.isInitialized) {
      // Clean up in reverse FK order
      await ds.getRepository(BranchSettings).delete({ organization_id: orgId });
      await ds.getRepository(BranchSettings).delete({ organization_id: otherOrgId });
      await ds.getRepository(Branch).delete({ organization_id: orgId });
      await ds.getRepository(Branch).delete({ organization_id: otherOrgId });
      await ds.getRepository(TenantSettings).delete({ organization_id: orgId });
      await ds.getRepository(TenantSettings).delete({ organization_id: otherOrgId });
      await ds.getRepository(Organization).delete({ id: orgId });
      await ds.getRepository(Organization).delete({ id: otherOrgId });
      await ds.destroy();
    }
  });

  it('two sequential PATCH calls to the same branch produce exactly one row (update, not insert)', async () => {
    // First PATCH - creates the row
    await service.update(orgId, branchId, { time_zone: 'Asia/Tokyo' }, 'user-1');
    // Second PATCH - should update the same row, not insert a new one
    await service.update(orgId, branchId, { locale: 'ja-JP' }, 'user-1');

    const rows = await ds.getRepository(BranchSettings).find({
      where: { branch_id: branchId, organization_id: orgId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].time_zone).toBe('Asia/Tokyo');
    expect(rows[0].locale).toBe('ja-JP');
    expect(rows[0].currency).toBeNull();
  });

  it('PATCH to different branches in same org produce separate rows', async () => {
    const anotherBranchId = randomUUID();
    await ds.getRepository(Branch).save({
      id: anotherBranchId,
      organization_id: orgId,
      name: 'Branch A2',
      is_active: true,
    });

    await service.update(orgId, branchId, { time_zone: 'Asia/Tokyo' }, 'user-1');
    await service.update(orgId, anotherBranchId, { time_zone: 'Europe/London' }, 'user-1');

    const rows = await ds.getRepository(BranchSettings).find({
      where: { organization_id: orgId },
    });
    expect(rows).toHaveLength(2);
    const timeZones = rows.map((r) => r.time_zone).sort();
    expect(timeZones).toEqual(['Asia/Tokyo', 'Europe/London']);
  });

  it('PATCH to branch in different org produces separate row', async () => {
    await service.update(orgId, branchId, { time_zone: 'Asia/Tokyo' }, 'user-1');
    await service.update(otherOrgId, otherBranchId, { time_zone: 'Europe/Paris' }, 'user-2');

    const orgARows = await ds.getRepository(BranchSettings).find({
      where: { organization_id: orgId },
    });
    const orgBRows = await ds.getRepository(BranchSettings).find({
      where: { organization_id: otherOrgId },
    });
    expect(orgARows).toHaveLength(1);
    expect(orgBRows).toHaveLength(1);
    expect(orgARows[0].time_zone).toBe('Asia/Tokyo');
    expect(orgBRows[0].time_zone).toBe('Europe/Paris');
  });

  it('explicit null clears override back to inherited value', async () => {
    // First set an override
    await service.update(orgId, branchId, { time_zone: 'Asia/Tokyo' }, 'user-1');
    let effective = await service.getEffective(orgId, branchId);
    expect(effective.effective.time_zone).toBe('Asia/Tokyo');
    expect(effective.overrides.time_zone).toBe(true);

    // Then clear it with explicit null
    await service.update(orgId, branchId, { time_zone: null }, 'user-1');
    effective = await service.getEffective(orgId, branchId);
    expect(effective.effective.time_zone).toBe('UTC'); // falls back to org setting
    expect(effective.overrides.time_zone).toBe(false);

    // Row should still exist but with null time_zone
    const rows = await ds.getRepository(BranchSettings).find({
      where: { branch_id: branchId, organization_id: orgId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].time_zone).toBeNull();
  });
});

describeIntegration('ValidationPipe integration for UpdateBranchSettingsDto (Fix 1)', () => {
  it('preserves decorated DTO properties through ValidationPipe with whitelist: true', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      { time_zone: 'Asia/Tokyo' },
      { type: 'body', metatype: UpdateBranchSettingsDto },
    );
    expect(result.time_zone).toBe('Asia/Tokyo');
    expect(result.locale).toBeUndefined();
    expect(result.currency).toBeUndefined();
  });

  it('allows explicit null to clear an override', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      { time_zone: null, locale: 'en-US' },
      { type: 'body', metatype: UpdateBranchSettingsDto },
    );
    expect(result.time_zone).toBeNull();
    expect(result.locale).toBe('en-US');
  });

  it('strips unknown properties', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = await pipe.transform(
      { time_zone: 'Asia/Tokyo', unknown_field: 'should be stripped' },
      { type: 'body', metatype: UpdateBranchSettingsDto },
    );
    expect(result.time_zone).toBe('Asia/Tokyo');
    expect((result as Record<string, unknown>).unknown_field).toBeUndefined();
  });
});