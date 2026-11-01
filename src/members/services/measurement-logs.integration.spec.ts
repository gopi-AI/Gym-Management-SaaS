/**
 * P2-07 — real-Postgres proof that measurement writes are tenant-scoped.
 *
 * The security invariant is:
 *
 *   A caller may write measurements only for a member whose organization
 *   matches the caller's authenticated organization.
 *
 * These tests use a real `DataSource`, real repositories and the real
 * `MeasurementLogsService`. They do NOT mock the repository, EntityManager or
 * DataSource, and every write assertion is made through a second read.
 *
 * Coverage:
 *   1. Same-organization write succeeds, persists the measurement and updates
 *      the target member's profile.
 *   2. Cross-organization write (Org-A caller, Org-B member) is rejected and
 *      performs no measurement insert and no profile update.
 *   3. A missing member is rejected with no write.
 *   4. The reverse direction (Org-B caller, Org-A member) is also rejected.
 *
 * RUNNING IT
 *   RUN_DB_INTEGRATION=1 \
 *     DB_HOST=<host> DB_PORT=<port> DB_USERNAME=<user> DB_PASSWORD=<password> \
 *     DB_DATABASE=<scratch> \
 *     npx jest src/members/services/measurement-logs.integration.spec
 *
 * The database MUST already be migrated. All five DB_* variables are required
 * explicitly — this spec deliberately has no defaults, so a missing variable
 * can never fall back to `gym_management`. The database name must match the
 * repository's scratch-database allowlist. Point it at a THROWAWAY database;
 * the seeded rows are deleted in `afterEach`/`afterAll`, but that cleanup is a
 * courtesy, not a substitute for an isolated database.
 *
 * Without `RUN_DB_INTEGRATION=1` the block reports as SKIPPED, so the hermetic
 * suite never needs a database.
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { MeasurementLogsService } from './measurement-logs.service';
import {
  MeasurementLog,
  MeasurementType,
} from '../entities/measurement-log.entity';
import { MemberProfile } from '../entities/member-profile.entity';
import { Member } from '../entities/member.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

const REQUIRED_DB_ENV = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
] as const;

/**
 * Only an explicitly created scratch/test database may be targeted. This is an
 * allowlist, not a blocklist: `gym_management` and any unmarked name are
 * refused before a connection is opened. Mirrors the guard in
 * `members.service.integration.spec.ts`.
 */
const ALLOWED_DATABASE_PATTERN =
  /^gym_(?:[a-z0-9]+_)*(?:scratch|gate|test|verify|ci)(?:_[a-z0-9]+)*$/i;

function requireDbConfig(): void {
  const missing = REQUIRED_DB_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[measurement-logs.integration.spec] RUN_DB_INTEGRATION=1 but required DB env vars are missing: ${missing.join(
        ', ',
      )}. Set DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD and DB_DATABASE explicitly (no defaults).`,
    );
  }
}

function assertTestDatabase(database: string): void {
  if (!ALLOWED_DATABASE_PATTERN.test(database)) {
    throw new Error(
      `[measurement-logs.integration.spec] Refusing to run against database "${database}". ` +
        'DB_DATABASE must be a scratch/test database (e.g. gym_p2_07_measurement_scratch_*).',
    );
  }
}

describeIntegration(
  'MeasurementLogsService (real Postgres, tenant-scoped writes)',
  () => {
    let dataSource: DataSource;
    let service: MeasurementLogsService;
    let measurementRepository: Repository<MeasurementLog>;
    let profileRepository: Repository<MemberProfile>;
    let memberRepository: Repository<Member>;
    let currentOrganizationId: string;

    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const branchA = randomUUID();
    const branchB = randomUUID();
    const memberA = randomUUID();
    const memberB = randomUUID();
    const profileA = randomUUID();
    const profileB = randomUUID();

    beforeAll(async () => {
      requireDbConfig();
      assertTestDatabase(process.env.DB_DATABASE as string);

      dataSource = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT as string, 10),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
        synchronize: false,
      });
      await dataSource.initialize();

      measurementRepository = dataSource.getRepository(MeasurementLog);
      profileRepository = dataSource.getRepository(MemberProfile);
      memberRepository = dataSource.getRepository(Member);

      // The tenant context is the only collaborator without a request behind
      // it here. It returns the fixture organization; the repositories and
      // DataSource are real.
      const tenantContext = {
        getCurrentOrganizationId: jest.fn(async () => currentOrganizationId),
        getRequestedOrganizationId: jest.fn(async () => null),
        requireOrganizationAccess: jest.fn(async () => currentOrganizationId),
      };

      service = new MeasurementLogsService(
        measurementRepository,
        profileRepository,
        memberRepository,
        dataSource,
        tenantContext as unknown as TenantContextService,
      );
    });

    beforeEach(async () => {
      currentOrganizationId = organizationA;

      await measurementRepository.delete({
        member_id: In([memberA, memberB]),
      });
      await profileRepository.delete({
        member_id: In([memberA, memberB]),
      });
      await memberRepository.delete({ id: In([memberA, memberB]) });

      await memberRepository.save([
        memberRepository.create({
          id: memberA,
          organization_id: organizationA,
          branch_id: branchA,
          global_uuid: randomUUID(),
          local_id: 1,
          first_name: 'Org',
          last_name: 'A',
        }),
        memberRepository.create({
          id: memberB,
          organization_id: organizationB,
          branch_id: branchB,
          global_uuid: randomUUID(),
          local_id: 1,
          first_name: 'Org',
          last_name: 'B',
        }),
      ]);

      await profileRepository.save([
        profileRepository.create({
          id: profileA,
          member_id: memberA,
          weight: '70.00',
          body_fat: '20.00',
        }),
        profileRepository.create({
          id: profileB,
          member_id: memberB,
          weight: '70.00',
          body_fat: '20.00',
        }),
      ]);
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await measurementRepository.delete({
          member_id: In([memberA, memberB]),
        });
        await profileRepository.delete({
          member_id: In([memberA, memberB]),
        });
        await memberRepository.delete({ id: In([memberA, memberB]) });
        await dataSource.destroy();
      }
    });

    function measurementDto(memberId: string, value: number) {
      return {
        member_id: memberId,
        measurement_type: MeasurementType.WEIGHT,
        value,
        unit: 'kg',
        measured_at: '2026-11-01T00:00:00.000Z',
        notes: 'P2-07 integration',
      };
    }

    it('persists a same-organization measurement and updates that member profile', async () => {
      const saved = await service.create(measurementDto(memberA, 80));

      expect(saved.organization_id).toBe(organizationA);
      expect(saved.member_id).toBe(memberA);

      const rows = await measurementRepository.find({
        where: { member_id: memberA },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].organization_id).toBe(organizationA);
      expect(Number(rows[0].value)).toBe(80);

      const profile = await profileRepository.findOne({
        where: { member_id: memberA },
      });
      expect(profile?.weight).toBe('80');

      const otherProfile = await profileRepository.findOne({
        where: { member_id: memberB },
      });
      expect(otherProfile?.weight).toBe('70.00');
    });

    it('rejects an Org-A caller targeting an Org-B member and performs no write', async () => {
      currentOrganizationId = organizationA;

      await expect(
        service.create(measurementDto(memberB, 90)),
      ).rejects.toBeInstanceOf(NotFoundException);

      const rows = await measurementRepository.find({
        where: { member_id: memberB },
      });
      expect(rows).toHaveLength(0);

      const profile = await profileRepository.findOne({
        where: { member_id: memberB },
      });
      expect(profile?.weight).toBe('70.00');
    });

    it('rejects a missing member and performs no write', async () => {
      const missingMemberId = randomUUID();

      await expect(
        service.create(measurementDto(missingMemberId, 90)),
      ).rejects.toBeInstanceOf(NotFoundException);

      const rows = await measurementRepository.find({
        where: { member_id: missingMemberId },
      });
      expect(rows).toHaveLength(0);
    });

    it('rejects an Org-B caller targeting an Org-A member and performs no write', async () => {
      currentOrganizationId = organizationB;

      await expect(
        service.create(measurementDto(memberA, 90)),
      ).rejects.toBeInstanceOf(NotFoundException);

      const rows = await measurementRepository.find({
        where: { member_id: memberA },
      });
      expect(rows).toHaveLength(0);

      const profile = await profileRepository.findOne({
        where: { member_id: memberA },
      });
      expect(profile?.weight).toBe('70.00');
    });
  },
);
