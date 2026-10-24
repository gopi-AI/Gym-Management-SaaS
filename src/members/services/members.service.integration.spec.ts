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
    // Dedicated volume fixture for the index-eligibility EXPLAINs, so the
    // planner's choice between the org-prefixed indexes is driven by the
    // email/phone predicates instead of tie-breaking on a tiny table.
    orgIndex: randomUUID(),
    branchIndex: randomUUID(),
  };

  const day = (n: number) => new Date(Date.UTC(2026, 0, 10 + n));

  // Row count for the index fixture. Below a few hundred rows every candidate
  // index costs the same, so the planner's choice would be a tie-break; with
  // this volume and fresh statistics the composite index is strictly cheaper.
  const INDEX_FIXTURE_ROWS = 2000;

  const REQUIRED_DB_ENV = [
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
  ] as const;

  // Production database names that must never be targeted by integration tests.
  const FORBIDDEN_DATABASES = new Set(['gym_management']);

  // Only an explicitly created scratch/test database may be targeted. This is an
  // allowlist, not a blocklist: a name whose `_`-separated segments carry no
  // scratch marker is refused before any connection is opened, so a typo cannot
  // reach a real database (`gym_management`, `postgres`, a developer's own
  // database). Every scratch name this repository actually uses still passes:
  // `gym_scratch_*`, `gym_gate_*` (api:gate), `gym_ci_<run>_<attempt>` (the CI
  // integration job) and the marker-in-the-middle forms such as
  // `gym_branch_settings_scratch`. Markers must be whole segments, so the `ci`
  // inside `specific` does not qualify a name on its own.
  const ALLOWED_DATABASE_PATTERN =
    /^gym_(?:[a-z0-9]+_)*(?:scratch|gate|test|verify|ci)(?:_[a-z0-9]+)*$/i;

  function requireDbConfig(): void {
    const missing = REQUIRED_DB_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[members.service.integration.spec] RUN_DB_INTEGRATION=1 but required DB env vars are missing: ${missing.join(
          ', ',
        )}. Set DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_DATABASE explicitly (no defaults).`,
      );
    }
  }

  function assertTestDatabase(database: string): void {
    if (FORBIDDEN_DATABASES.has(database)) {
      throw new Error(
        `[members.service.integration.spec] Refusing to run integration tests against the production database '${database}'. ` +
          'DB_DATABASE must point to a scratch/test database (e.g. gym_scratch_p107_tier2 or gym_gate_*).',
      );
    }
    if (!ALLOWED_DATABASE_PATTERN.test(database)) {
      throw new Error(
        `[members.service.integration.spec] Refusing to run integration tests against database '${database}': ` +
          `it does not match the scratch/test allowlist ${ALLOWED_DATABASE_PATTERN}. ` +
          'Create a dedicated scratch database (e.g. gym_scratch_p107_tier2, gym_gate_<runid> or gym_ci_<run>_<attempt>) and point DB_DATABASE at it.',
      );
    }
  }

  beforeAll(async () => {
    // Fail closed: require explicit connection configuration and pass a
    // test-database safety check before connecting or mutating any data.
    requireDbConfig();
    const database = process.env.DB_DATABASE!;
    assertTestDatabase(database);

    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT!, 10),
      username: process.env.DB_USERNAME!,
      password: process.env.DB_PASSWORD!,
      database,
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

    // Volume fixture for the index-eligibility tests. `ANALYZE` is required:
    // without column statistics Postgres falls back to default selectivities
    // and picks the plain (organization_id) index even at this row count.
    await dataSource.getRepository(Organization).save({
      id: ids.orgIndex,
      name: 'Org Index',
      timezone: 'UTC',
      locale: 'en-US',
      currency: 'USD',
    });
    await dataSource.getRepository(Branch).save({
      id: ids.branchIndex,
      organization_id: ids.orgIndex,
      name: 'Index',
      address: '4 Test Street',
      phone: '+10000000003',
      is_active: true,
    });
    await dataSource.query(
      `INSERT INTO "MEMBERS_MEMBERS"
         ("organization_id", "branch_id", "global_uuid", "local_id",
          "first_name", "last_name", "email", "phone", "is_active", "created_at")
       SELECT $1, $2, gen_random_uuid(), g, 'Index' || g, 'Fixture',
              'index' || g || '@example.com', '+9000' || lpad(g::text, 6, '0'),
              true, now()
       FROM generate_series(1, $3) AS g`,
      [ids.orgIndex, ids.branchIndex, INDEX_FIXTURE_ROWS],
    );
    await dataSource.query('ANALYZE "MEMBERS_MEMBERS"');

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
    await dataSource.getRepository(Member).delete({ organization_id: ids.orgIndex });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.organization });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.orgB });
    await dataSource.getRepository(Branch).delete({ organization_id: ids.orgIndex });
    await dataSource.getRepository(Organization).delete({ id: ids.organization });
    await dataSource.getRepository(Organization).delete({ id: ids.orgB });
    await dataSource.getRepository(Organization).delete({ id: ids.orgIndex });
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

    it('EXPLAIN shows the org-scoped list query can use an index (seqscan disabled for eligibility)', async () => {
      // enable_seqscan = off forces the planner to consider index paths. This
      // proves the P1-07 indexes are eligible/usable for the org-scoped list
      // query. It does not claim the default planner always picks an index:
      // small tables may still seq scan under default planner settings.
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
        await queryRunner.query('RESET enable_seqscan');
        await queryRunner.release();
      }
    });

    // The three tests below run against the dedicated ANALYZE'd volume fixture
    // (ids.orgIndex). On the four-row fixture every candidate index costs the
    // same, so the planner's pick is a tie-break rather than evidence about the
    // email/phone indexes; with fresh statistics on a few thousand rows the
    // predicate selectivity decides. `enable_seqscan = off` keeps the claim to
    // eligibility — the index can serve the predicate — and not proof that the
    // default planner always chooses it on a small table.
    it('EXPLAIN shows the email filter is served by the (organization_id, email) index', async () => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.query('SET enable_seqscan = off');
      try {
        const explain = await queryRunner.query(
          `EXPLAIN (FORMAT TEXT)
           SELECT "id" FROM "MEMBERS_MEMBERS"
           WHERE "organization_id" = $1 AND "email" = $2 AND "is_active" = $3
           LIMIT 1`,
          [ids.orgIndex, 'index1500@example.com', true],
        );
        const plan = explain.map((r: Record<string, string>) => Object.values(r).join(' ')).join('\n');
        expect(plan).not.toContain('Seq Scan');
        expect(plan).toContain('IDX_members_members_organization_id_email');
        // Isolation: the email predicate must be served by the email index, not
        // fall back to the phone index that shares the organization_id prefix.
        expect(plan).not.toContain('IDX_members_members_organization_id_phone');
      } finally {
        // RESET before the connection returns to the pool: a leaked
        // enable_seqscan=off would silently change later plans.
        await queryRunner.query('RESET enable_seqscan');
        await queryRunner.release();
      }
    });

    it('EXPLAIN shows the phone filter is served by the (organization_id, phone) index', async () => {
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.query('SET enable_seqscan = off');
      try {
        const explain = await queryRunner.query(
          `EXPLAIN (FORMAT TEXT)
           SELECT "id" FROM "MEMBERS_MEMBERS"
           WHERE "organization_id" = $1 AND "phone" = $2 AND "is_active" = $3
           LIMIT 1`,
          [ids.orgIndex, '+9000001500', true],
        );
        const plan = explain.map((r: Record<string, string>) => Object.values(r).join(' ')).join('\n');
        expect(plan).not.toContain('Seq Scan');
        expect(plan).toContain('IDX_members_members_organization_id_phone');
        expect(plan).not.toContain('IDX_members_members_organization_id_email');
      } finally {
        await queryRunner.query('RESET enable_seqscan');
        await queryRunner.release();
      }
    });

    it('EXPLAIN shows the duplicate-contact OR predicate is served by both new indexes', async () => {
      // Production shape: ensureNoDuplicateContact() calls findOne() with an
      // array of conditions, which TypeORM emits as this OR. The planner
      // satisfies it with a BitmapOr over both (organization_id, email) and
      // (organization_id, phone), so both indexes are named in one plan.
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.query('SET enable_seqscan = off');
      try {
        const explain = await queryRunner.query(
          `EXPLAIN (FORMAT TEXT)
           SELECT "id" FROM "MEMBERS_MEMBERS"
           WHERE ("email" = $2 AND "organization_id" = $1 AND "is_active" = $4)
              OR ("phone" = $3 AND "organization_id" = $1 AND "is_active" = $4)
           LIMIT 1`,
          [ids.orgIndex, 'index1500@example.com', '+9000001500', true],
        );
        const plan = explain.map((r: Record<string, string>) => Object.values(r).join(' ')).join('\n');
        expect(plan).not.toContain('Seq Scan');
        expect(plan).toContain('IDX_members_members_organization_id_email');
        expect(plan).toContain('IDX_members_members_organization_id_phone');
      } finally {
        await queryRunner.query('RESET enable_seqscan');
        await queryRunner.release();
      }
    });

    it('org-scoped list query returns correct rows under the default planner', async () => {
      // Default planner (enable_seqscan = on). With a small seed set the planner
      // may choose a seq scan; this test verifies query correctness under default
      // planner settings, not index selection.
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.query('SET enable_seqscan = on');
      try {
        const rows = await queryRunner.query(
          `SELECT id FROM "MEMBERS_MEMBERS"
           WHERE "organization_id" = $1 AND "is_active" = $2
           ORDER BY "created_at" DESC LIMIT 20`,
          [ids.organization, true],
        );
        const returnedIds = new Set(rows.map((r: { id: string }) => r.id));
        expect(returnedIds).toEqual(new Set([ids.mCarol, ids.mBob, ids.mAlice]));
      } finally {
        await queryRunner.release();
      }
    });
  });
});
