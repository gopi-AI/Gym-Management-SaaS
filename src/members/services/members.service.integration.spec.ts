import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { MembersService } from './members.service';
import { Member } from '../entities/member.entity';
import { MemberProfile } from '../entities/member-profile.entity';
import { Organization } from '../../tenancy/entities/organization.entity';
import { Branch } from '../../tenancy/entities/branch.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { LocalIdService } from './local-id.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

describeIntegration('MembersService search/sort/indexes (real Postgres)', () => {
  let dataSource: DataSource;
  let service: MembersService;
  const ids = {
    organization: randomUUID(),
    orgB: randomUUID(),
    branchA: randomUUID(),
    branchB: randomUUID(),
    branchBOrgB: randomUUID(),
    mAlice: randomUUID(),
    mBob: randomUUID(),
    mCarol: randomUUID(),
    mDan: randomUUID(), // inactive
    mEve: randomUUID(), // lives in orgB
  };

  const day = (n: number) => new Date(Date.UTC(2026, 0, 10 + n));

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_DATABASE || 'gym_management',
      // Same resolution rule as `src/data-source.ts`, so this spec can never
      // drift from the entities the application actually maps.
      entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
      synchronize: false,
    });
    await dataSource.initialize();

    await dataSource.getRepository(Organization).save({
      id: ids.organization,
      name: 'Org A',
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    await dataSource.getRepository(Organization).save({
      id: ids.orgB,
      name: 'Org B',
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    await dataSource.getRepository(Branch).save({
      id: ids.branchA,
      organization_id: ids.organization,
      name: 'Main',
      address: '1 Test Street',
      phone: '+10000000000',
      is_active: true,
    });
    await dataSource.getRepository(Branch).save({
      id: ids.branchB,
      organization_id: ids.organization,
      name: 'North',
      address: '2 Test Street',
      phone: '+10000000001',
      is_active: true,
    });
    await dataSource.getRepository(Branch).save({
      id: ids.branchBOrgB,
      organization_id: ids.orgB,
      name: 'Central',
      address: '3 Test Street',
      phone: '+10000000002',
      is_active: true,
    });

    const memberRepo = dataSource.getRepository(Member);
    await memberRepo.save(
      memberRepo.create({
        id: ids.mAlice,
        organization_id: ids.organization,
        branch_id: ids.branchA,
        global_uuid: randomUUID(),
        local_id: 1,
        first_name: 'Alice',
        last_name: 'Smith',
        email: 'alice@example.com',
        phone: '+1111111111',
        is_active: true,
        created_at: day(0),
      }),
    );
    await memberRepo.save(
      memberRepo.create({
        id: ids.mBob,
        organization_id: ids.organization,
        branch_id: ids.branchA,
        global_uuid: randomUUID(),
        local_id: 2,
        first_name: 'Bob',
        last_name: 'Jones',
        email: 'bob@example.com',
        phone: '+2222222222',
        is_active: true,
        created_at: day(1),
      }),
    );
    await memberRepo.save(
      memberRepo.create({
        id: ids.mCarol,
        organization_id: ids.organization,
        branch_id: ids.branchB,
        global_uuid: randomUUID(),
        local_id: 3,
        first_name: 'Carol',
        last_name: 'Smith',
        email: 'carol@example.com',
        phone: '+3333333333',
        is_active: true,
        created_at: day(2),
      }),
    );
    await memberRepo.save(
      memberRepo.create({
        id: ids.mDan,
        organization_id: ids.organization,
        branch_id: ids.branchA,
        global_uuid: randomUUID(),
        local_id: 4,
        first_name: 'Dan',
        last_name: 'Lee',
        email: 'dan@example.com',
        phone: '+4444444444',
        is_active: false,
        created_at: day(3),
      }),
    );
    await memberRepo.save(
      memberRepo.create({
        id: ids.mEve,
        organization_id: ids.orgB,
        branch_id: ids.branchBOrgB,
        global_uuid: randomUUID(),
        local_id: 1,
        first_name: 'Eve',
        last_name: 'Smith',
        email: 'eve@example.com',
        phone: '+5555555555',
        is_active: true,
        created_at: day(0),
      }),
    );

    // Collaborators are stand-ins: `findAll` only reaches the member repository
    // and the tenant context (for the organization id). Wiring mirrors the
    // memberships integration spec, which drives the same constructor shape.
    const tenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      getRequestedOrganizationId: jest.fn().mockResolvedValue(ids.organization),
      requireOrganizationAccess: jest.fn().mockResolvedValue(ids.organization),
      getCurrentUserId: jest.fn().mockResolvedValue(randomUUID()),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    } as unknown as TenantContextService;

    service = new MembersService(
      dataSource.getRepository(Member),
      dataSource.getRepository(MemberProfile),
      dataSource,
      {} as LocalIdService,
      tenantContext,
      {} as OutboxService,
    );
  }, 30000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.getRepository(Member).delete({ organization_id: ids.organization });
    await dataSource.getRepository(Member).delete({ organization_id: ids.orgB });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.organization });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.orgB });
    await dataSource.getRepository(Organization).delete({ id: ids.organization });
    await dataSource.getRepository(Organization).delete({ id: ids.orgB });
    await dataSource.destroy();
  }, 30000);

  describe('findAll search (ILike across first_name/last_name/email/phone)', () => {
    it('matches case-insensitively across first_name', async () => {
      const { data, total } = await service.findAll({ search: 'ALICE' });
      expect(total).toBe(1);
      expect(data[0].id).toBe(ids.mAlice);
    });

    it('matches case-insensitively across last_name', async () => {
      const { data, total } = await service.findAll({ search: 'smith' });
      expect(total).toBe(2);
      expect(new Set(data.map((m) => m.id))).toEqual(new Set([ids.mAlice, ids.mCarol]));
    });

    it('matches case-insensitively across email', async () => {
      const { total } = await service.findAll({ search: 'BOB@EXAMPLE.COM' });
      expect(total).toBe(1);
    });

    it('matches case-insensitively across phone', async () => {
      const { total } = await service.findAll({ search: '3333333' });
      expect(total).toBe(1);
    });

    it('applies org scoping to every OR branch (excludes other tenants)', async () => {
      const { total } = await service.findAll({ search: 'Smith' });
      // Alice + Carol match, Eve (orgB, also Smith) must be excluded.
      expect(total).toBe(2);
    });

    it('applies is_active scoping to every OR branch (excludes inactive)', async () => {
      const { total } = await service.findAll({ search: 'Lee' });
      // Dan matches by name but is inactive.
      expect(total).toBe(0);
    });

    it('applies branch scoping to every OR branch', async () => {
      const { data, total } = await service.findAll({ search: 'Smith', branch_id: ids.branchA });
      expect(total).toBe(1);
      expect(data[0].id).toBe(ids.mAlice);
    });

    it('returns zero rows when nothing matches', async () => {
      const { total } = await service.findAll({ search: 'zzz-no-match' });
      expect(total).toBe(0);
    });
  });

  describe('findAll org / active scoping (non-search branch)', () => {
    it('lists only active members of the authorized organization', async () => {
      const { data, total } = await service.findAll({});
      expect(total).toBe(3);
      expect(new Set(data.map((m) => m.id))).toEqual(
        new Set([ids.mAlice, ids.mBob, ids.mCarol]),
      );
      // Dan (inactive, orgA) and Eve (orgB) are both excluded.
      expect(data.some((m) => m.id === ids.mDan)).toBe(false);
      expect(data.some((m) => m.id === ids.mEve)).toBe(false);
    });
  });

  describe('findAll sort_by / sort_dir', () => {
    it('defaults to created_at DESC when neither sort param is given', async () => {
      const { data } = await service.findAll({});
      expect(data.map((m) => m.id)).toEqual([ids.mCarol, ids.mBob, ids.mAlice]);
    });

    it('sorts by first_name ASC', async () => {
      const { data } = await service.findAll({ sort_by: 'first_name', sort_dir: 'asc' });
      expect(data.map((m) => m.id)).toEqual([ids.mAlice, ids.mBob, ids.mCarol]);
    });

    it('sorts by last_name DESC (Smiths first, Jones last)', async () => {
      const { data } = await service.findAll({ sort_by: 'last_name', sort_dir: 'desc' });
      expect(data[0].last_name).toBe('Smith');
      expect(data[data.length - 1].id).toBe(ids.mBob);
    });

    it('sorts by local_id ASC', async () => {
      const { data } = await service.findAll({ sort_by: 'local_id', sort_dir: 'asc' });
      expect(data.map((m) => m.id)).toEqual([ids.mAlice, ids.mBob, ids.mCarol]);
    });

    it('sorts by created_at ASC', async () => {
      const { data } = await service.findAll({ sort_by: 'created_at', sort_dir: 'asc' });
      expect(data.map((m) => m.id)).toEqual([ids.mAlice, ids.mBob, ids.mCarol]);
    });

    it('sort_dir defaults to asc when sort_by is given alone', async () => {
      const { data } = await service.findAll({ sort_by: 'first_name' });
      expect(data.map((m) => m.id)).toEqual([ids.mAlice, ids.mBob, ids.mCarol]);
    });
  });

  describe('P1-07 indexes', () => {
    it('the three btree indexes exist on MEMBERS_MEMBERS', async () => {
      const rows = await dataSource.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'MEMBERS_MEMBERS'`,
      );
      const names = rows.map((r: { indexname: string }) => r.indexname);
      for (const idx of [
        'IDX_members_members_organization_id',
        'IDX_members_members_organization_id_email',
        'IDX_members_members_organization_id_phone',
      ]) {
        expect(names).toContain(idx);
      }
    });

    it('EXPLAIN shows the org-scoped list query uses an index (no seq scan)', async () => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.query('SET enable_seqscan = off');
      try {
        const explain = await queryRunner.query(
          `EXPLAIN (FORMAT TEXT)
           SELECT * FROM "MEMBERS_MEMBERS"
           WHERE "organization_id" = $1 AND "is_active" = $2
           ORDER BY "created_at" DESC LIMIT 20`,
          [ids.organization, true],
        );
        const plan = explain.map((r: Record<string, string>) => Object.values(r).join(' ')).join('\n');
        expect(plan).not.toContain('Seq Scan');
        expect(plan).toMatch(/Index Scan|Bitmap Index Scan/);
      } finally {
        await queryRunner.release();
      }
    });
  });
});
