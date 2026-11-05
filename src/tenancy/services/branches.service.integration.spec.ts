import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { ForbiddenException } from '@nestjs/common';
import { AppDataSource } from '../../data-source';
import { BranchesService } from './branches.service';
import { OrganizationsService } from './organizations.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { IdentityService } from '../../identity/services/identity.service';
import { Organization } from '../entities/organization.entity';
import { Branch } from '../entities/branch.entity';
import { IdentityUser } from '../../identity/entities/identity-users.entity';
import { IdentityRole } from '../../identity/entities/identity-roles.entity';
import { IdentityPermission } from '../../identity/entities/identity-permissions.entity';
import { IdentityUserOrganization } from '../../identity/entities/identity-user-organizations.entity';
import { IdentityRolePermission } from '../../identity/entities/identity-role-permissions.entity';
import { IdentityUserRole } from '../../identity/entities/identity-user-roles.entity';

const RUN = process.env.RUN_DB_INTEGRATION === '1';
const describeIntegration = RUN ? describe : describe.skip;

const USER_ID = randomUUID();
const ROLE_ID = randomUUID();
const PERM_ID = randomUUID();
const ORG_A = randomUUID(); // active, user has active membership + branch:create role
const ORG_B = randomUUID(); // active, user has NO active membership (used as the foreign body org)
const ORG_C = randomUUID(); // inactive organization

describeIntegration('BranchesService.create — organization authorization (real DB)', () => {
  let ds: DataSource;
  let service: BranchesService;
  let tenantContext: TenantContextService;
  let orgRepository: Repository<Organization>;
  let branchRepository: Repository<Branch>;
  let membershipRepository: Repository<IdentityUserOrganization>;

  beforeAll(async () => {
    ds = await AppDataSource.initialize();
    orgRepository = ds.getRepository(Organization);
    branchRepository = ds.getRepository(Branch);
    membershipRepository = ds.getRepository(IdentityUserOrganization);

    const identityService = new IdentityService(
      ds.getRepository(IdentityUser),
      ds.getRepository(IdentityRole),
      ds.getRepository(IdentityPermission),
      ds.getRepository(IdentityUserRole),
      ds.getRepository(IdentityRolePermission),
      ds.getRepository(IdentityUserOrganization),
    );
    tenantContext = new TenantContextService(identityService, branchRepository);
    const organizationsService = new OrganizationsService(orgRepository, tenantContext);
    service = new BranchesService(branchRepository, organizationsService, tenantContext);

    await orgRepository.save([
      { id: ORG_A, name: 'Org A', timezone: 'UTC', locale: 'en-US', currency: 'USD', is_active: true },
      { id: ORG_B, name: 'Org B', timezone: 'UTC', locale: 'en-US', currency: 'USD', is_active: true },
      { id: ORG_C, name: 'Org C (inactive)', timezone: 'UTC', locale: 'en-US', currency: 'USD', is_active: false },
    ]);

    await ds.getRepository(IdentityUser).save({
      id: USER_ID, email: 'user@example.com', password_hash: 'x',
      first_name: 'U', last_name: 'User', is_active: true,
    });

    await ds.getRepository(IdentityRole).save({
      id: ROLE_ID, name: 'Branch Creator', description: 'can create branches', is_active: true,
    });
    await ds.getRepository(IdentityPermission).save({
      id: PERM_ID, name: 'Create branches', description: '', resource: 'branch', action: 'create', is_active: true,
    });
    await ds.getRepository(IdentityRolePermission).save({
      id: randomUUID(), role_id: ROLE_ID, permission_id: PERM_ID,
    });
    await ds.getRepository(IdentityUserRole).save({
      id: randomUUID(), user_id: USER_ID, role_id: ROLE_ID,
    });

    // Active membership in ORG_A (the authorized organization).
    await membershipRepository.save({
      id: randomUUID(), user_id: USER_ID, organization_id: ORG_A, role_id: ROLE_ID, is_active: true,
    });
  }, 30000);

  async function withOrgContext(orgId: string, fn: () => Promise<unknown>): Promise<unknown> {
    return tenantContext.runWithContext(
      { userId: USER_ID, requestedOrganizationId: orgId },
      fn,
    );
  }

  async function branchCountIn(orgId: string): Promise<number> {
    return branchRepository.count({ where: { organization_id: orgId } });
  }

  const dtoFor = (organization_id: string) => ({
    organization_id,
    name: 'Gate Branch',
    address: '1 Gate Street',
    phone: '+1-555-0100',
  });

  it('A. rejects a header/body organization mismatch and writes nothing (the P0-05 defect)', async () => {
    // Authorized org = ORG_A (header). Body targets ORG_B. The guard authorized ORG_A,
    // so the service must refuse to create in ORG_B.
    let caught: unknown;
    await withOrgContext(ORG_A, async () => {
      caught = await service.create(dtoFor(ORG_B)).catch((error) => error);
    });

    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).message).toContain('Organization body does not match authorized organization');

    // No branch written to either organization.
    expect(await branchCountIn(ORG_A)).toBe(0);
    expect(await branchCountIn(ORG_B)).toBe(0);
    expect(await branchRepository.count()).toBe(0);
  });

  it('B. creates the branch in the authorized organization when header and body match', async () => {
    await withOrgContext(ORG_A, async () => {
      const branch = await service.create(dtoFor(ORG_A));
      expect(branch.organization_id).toBe(ORG_A);
      expect(branch.name).toBe('Gate Branch');
    });

    // A branch exists only in the authorized organization ORG_A.
    expect(await branchCountIn(ORG_A)).toBe(1);
    expect(await branchCountIn(ORG_B)).toBe(0);
    expect(await branchRepository.count()).toBe(1);
  });

  it('E. rejects creation when the user has no active membership in the selected organization', async () => {
    // ORG_B is active but the user has no active membership there.
    let caught: unknown;
    await withOrgContext(ORG_B, async () => {
      caught = await service.create(dtoFor(ORG_B)).catch((error) => error);
    });

    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).message).toContain(
      'Access to this organization is not allowed',
    );

    // No branch written to the requested organization; no net new write.
    expect(await branchCountIn(ORG_B)).toBe(0);
    expect(await branchCountIn(ORG_A)).toBe(1);
    expect(await branchRepository.count()).toBe(1);
  });

  afterAll(async () => {
    if (ds) {
      try {
        await ds.destroy();
      } catch (_e) {
        // ignore teardown errors; the scratch database is discarded after the run
      }
    }
  });
});