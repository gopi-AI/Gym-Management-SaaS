import { Test, TestingModule } from '@nestjs/testing';
import { FindOperator, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdentityService } from './identity.service';
import { IdentityUser } from '../entities/identity-users.entity';
import { IdentityRole } from '../entities/identity-roles.entity';
import { IdentityPermission } from '../entities/identity-permissions.entity';
import { IdentityUserRole } from '../entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../entities/identity-role-permissions.entity';
import { IdentityUserOrganization } from '../entities/identity-user-organizations.entity';
import { Organization } from '../../tenancy/entities/organization.entity';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const PERM_ID = '44444444-4444-4444-8444-444444444444';
const GLOBAL_ROLE_ID = '88888888-8888-4888-8888-888888888888';

function activeRole(id = ROLE_ID): IdentityRole {
  return { id, name: 'test-role', description: '', is_active: true } as IdentityRole;
}

function inactiveRole(id = ROLE_ID): IdentityRole {
  return { id, name: 'inactive-role', description: '', is_active: false } as IdentityRole;
}

function activePermission(id = PERM_ID): IdentityPermission {
  return { id, name: 'test:read', description: '', resource: 'test', action: 'read', is_active: true } as IdentityPermission;
}

function inactivePermission(id = PERM_ID): IdentityPermission {
  return { id, name: 'test:read', description: '', resource: 'test', action: 'read', is_active: false } as IdentityPermission;
}

function userRole(roleId = ROLE_ID, role?: IdentityRole): IdentityUserRole {
  return { id: '55555555-5555-4555-8555-555555555555', user_id: USER_ID, role_id: roleId, role } as IdentityUserRole;
}

function rolePermission(roleId = ROLE_ID, permId = PERM_ID, permission?: IdentityPermission): IdentityRolePermission {
  return { id: '66666666-6666-4666-8666-666666666666', role_id: roleId, permission_id: permId, permission } as IdentityRolePermission;
}

function organization(isActive = true, id = ORG_ID): Organization {
  return { id, name: 'test-org', is_active: isActive } as Organization;
}

function membership(
  orgId = ORG_ID,
  roleId: string | null = ROLE_ID,
  isActive = true,
  role?: IdentityRole,
  org: Organization = organization(true, orgId),
): IdentityUserOrganization {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    user_id: USER_ID,
    organization_id: orgId,
    organization: org,
    role_id: roleId,
    role,
    is_active: isActive,
  } as IdentityUserOrganization;
}

/**
 * Apply a TypeORM `where` value the way the database would: an `In(...)`
 * operator matches a membership in its set, a scalar matches equality, and an
 * absent predicate matches every row.
 */
function matchesFilter(filter: unknown, value: string): boolean {
  if (filter instanceof FindOperator) {
    if (filter.type === 'in') {
      return (filter.value as string[]).includes(value);
    }
    return true;
  }
  return filter === undefined || filter === value;
}

/**
 * T1/T2 authorization unit coverage.
 *
 * The repository doubles below are QUERY-AWARE on purpose. A canned
 * `mockResolvedValue` cannot distinguish "the service refused because it
 * filtered an inactive row" from "the double returned null regardless of the
 * query", so it cannot detect removal of an active-state predicate (P0-05 M8).
 * Each double applies the `where` predicate and the `relations` the service
 * actually passes, against in-memory rows, so a test goes red if the service
 * stops asking the repository to exclude an inactive row.
 */
describe('IdentityService — authorization (T1 + T2)', () => {
  let service: IdentityService;
  let userRepository: jest.Mocked<Repository<IdentityUser>>;
  let roleRepository: jest.Mocked<Repository<IdentityRole>>;
  let userRoleRepository: jest.Mocked<Repository<IdentityUserRole>>;
  let rolePermissionRepository: jest.Mocked<Repository<IdentityRolePermission>>;
  let permissionRepository: jest.Mocked<Repository<IdentityPermission>>;
  let userOrganizationRepository: jest.Mocked<Repository<IdentityUserOrganization>>;

  // In-memory tables the doubles query.
  let roleRows: IdentityRole[];
  let permissionRows: IdentityPermission[];
  let userRoleRows: IdentityUserRole[];
  let rolePermissionRows: IdentityRolePermission[];
  let membershipRows: IdentityUserOrganization[];
  let organizationRows: Organization[];

  beforeEach(async () => {
    roleRows = [];
    permissionRows = [];
    userRoleRows = [];
    rolePermissionRows = [];
    membershipRows = [];
    organizationRows = [];

    userRepository = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<IdentityUser>>;
    roleRepository = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<IdentityRole>>;
    userRoleRepository = {
      find: jest.fn(async (options: any) => {
        const where = options?.where ?? {};
        const withRole = (options?.relations ?? []).includes('role');
        return userRoleRows
          .filter((ur) => where.user_id === undefined || ur.user_id === where.user_id)
          .map((ur) =>
            withRole ? { ...ur, role: roleRows.find((r) => r.id === ur.role_id) } : { ...ur },
          );
      }),
    } as unknown as jest.Mocked<Repository<IdentityUserRole>>;
    rolePermissionRepository = {
      find: jest.fn(async (options: any) => {
        const where = options?.where ?? {};
        const withPermission = (options?.relations ?? []).includes('permission');
        return rolePermissionRows
          .filter((rp) => matchesFilter(where.role_id, rp.role_id))
          .map((rp) =>
            withPermission
              ? { ...rp, permission: permissionRows.find((p) => p.id === rp.permission_id) }
              : { ...rp },
          );
      }),
    } as unknown as jest.Mocked<Repository<IdentityRolePermission>>;
    permissionRepository = {
      findOne: jest.fn(async (options: any) => {
        const where = options?.where ?? {};
        return (
          permissionRows.find(
            (p) =>
              matchesFilter(where.id, p.id) &&
              (where.resource === undefined || p.resource === where.resource) &&
              (where.action === undefined || p.action === where.action) &&
              (where.is_active === undefined || p.is_active === where.is_active),
          ) ?? null
        );
      }),
    } as unknown as jest.Mocked<Repository<IdentityPermission>>;
    userOrganizationRepository = {
      findOne: jest.fn(async (options: any) => {
        const where = options?.where ?? {};
        const relations: string[] = options?.relations ?? [];
        const row = membershipRows.find(
          (m) =>
            (where.user_id === undefined || m.user_id === where.user_id) &&
            (where.organization_id === undefined || m.organization_id === where.organization_id) &&
            (where.is_active === undefined || m.is_active === where.is_active),
        );
        if (!row) return null;
        return {
          ...row,
          organization: relations.includes('organization')
            ? organizationRows.find((o) => o.id === row.organization_id)
            : row.organization,
          role: relations.includes('role')
            ? roleRows.find((r) => r.id === row.role_id) ?? null
            : row.role,
        };
      }),
    } as unknown as jest.Mocked<Repository<IdentityUserOrganization>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: getRepositoryToken(IdentityUser), useValue: userRepository },
        { provide: getRepositoryToken(IdentityRole), useValue: roleRepository },
        { provide: getRepositoryToken(IdentityUserRole), useValue: userRoleRepository },
        { provide: getRepositoryToken(IdentityRolePermission), useValue: rolePermissionRepository },
        { provide: getRepositoryToken(IdentityPermission), useValue: permissionRepository },
        { provide: getRepositoryToken(IdentityUserOrganization), useValue: userOrganizationRepository },
      ],
    }).compile();

    service = module.get(IdentityService);
  });

  describe('hasPermission — global authorization (T1)', () => {
    it('allows active role + active permission', async () => {
      roleRows = [activeRole()];
      userRoleRows = [userRole(ROLE_ID)];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(true);

      // Positive control for the active-permission query: the service asks the
      // permission table for this exact resource/action AND requires is_active.
      const findOneOptions = permissionRepository.findOne.mock.calls[0][0] as any;
      expect(findOneOptions.where).toMatchObject({
        resource: 'test',
        action: 'read',
        is_active: true,
      });
      expect(findOneOptions.where.id).toBeInstanceOf(FindOperator);
      expect(findOneOptions.where.id.value).toEqual([PERM_ID]);
    });

    it('denies when the user has no roles', async () => {
      userRoleRows = [];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(false);
      expect(rolePermissionRepository.find).not.toHaveBeenCalled();
    });

    it('denies when the role is inactive', async () => {
      roleRows = [inactiveRole()];
      userRoleRows = [userRole(ROLE_ID)];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(false);
      expect(rolePermissionRepository.find).not.toHaveBeenCalled();
    });

    it('denies when the permission is inactive', async () => {
      // Active granting role, linked to an INACTIVE permission row. The
      // query-aware double returns that row only if the service asks for it
      // without the is_active predicate.
      roleRows = [activeRole()];
      userRoleRows = [userRole(ROLE_ID)];
      permissionRows = [inactivePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(false);

      // The relation is loaded, and the inactive permission is filtered out
      // before the permission table is queried. A service that dropped the
      // active-permission filter would call findOne here and receive the
      // inactive row from the faithful double (M8).
      expect(rolePermissionRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['permission'] }),
      );
      expect(permissionRepository.findOne).not.toHaveBeenCalled();
    });

    it('denies when the permission record is missing', async () => {
      // The junction row points at a permission id that has no permission row,
      // so the `relations: ['permission']` join leaves it unresolved.
      roleRows = [activeRole()];
      userRoleRows = [userRole(ROLE_ID)];
      permissionRows = [];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(false);
      expect(permissionRepository.findOne).not.toHaveBeenCalled();
    });

    it('denies when the role has no matching permission', async () => {
      roleRows = [activeRole()];
      userRoleRows = [userRole(ROLE_ID)];
      rolePermissionRows = [];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(false);
      expect(permissionRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('hasOrganizationPermission — organization-scoped authorization (T2)', () => {
    it('allows active membership + authorized organization role', async () => {
      roleRows = [activeRole()];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true)];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(true);
    });

    it('denies when the organization is deactivated even though the membership and its role are active', async () => {
      roleRows = [activeRole()];
      organizationRows = [organization(false)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true, activeRole(), organization(false))];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
      // Short-circuits on the organization state: the role's permission rows are
      // never loaded for an organization that is switched off.
      expect(rolePermissionRepository.find).not.toHaveBeenCalled();
    });

    it('allows when the organization is active and the role grants the permission', async () => {
      roleRows = [activeRole()];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true, activeRole(), organization(true))];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(true);
    });

    it('denies when the organization relation is missing from the membership row', async () => {
      // `relations: ['organization']` must be requested explicitly; a membership
      // loaded without it cannot prove the organization is active. The double
      // attaches relations from the in-memory tables, so an empty organization
      // table reproduces the missing relation.
      roleRows = [activeRole()];
      organizationRows = [];
      membershipRows = [membership(ORG_ID, ROLE_ID, true)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
      expect(userOrganizationRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ relations: ['organization', 'role'] }),
      );
      expect(rolePermissionRepository.find).not.toHaveBeenCalled();
    });

    it('denies when there is no membership', async () => {
      roleRows = [activeRole()];
      organizationRows = [organization(true)];
      membershipRows = [];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
    });

    it('denies when the membership is inactive', async () => {
      // The findOne query filters by is_active: true, so the query-aware double
      // does not return this row at all. The row exists, but the service never
      // sees it.
      roleRows = [activeRole()];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, false)];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
      expect(rolePermissionRepository.find).not.toHaveBeenCalled();
    });

    it('denies when the membership has a null role', async () => {
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, null, true)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
    });

    it('denies when the organization role is inactive', async () => {
      roleRows = [inactiveRole()];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true, inactiveRole())];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
      expect(rolePermissionRepository.find).not.toHaveBeenCalled();
    });

    it('denies when the organization role lacks the permission even though a global role has it', async () => {
      // The global path says yes; the tenant path must not borrow it.
      roleRows = [activeRole(GLOBAL_ROLE_ID), activeRole(ROLE_ID)];
      userRoleRows = [userRole(GLOBAL_ROLE_ID)];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(GLOBAL_ROLE_ID, PERM_ID)];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true)];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(true);
      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
      expect(rolePermissionRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role_id: ROLE_ID } }),
      );
    });

    it('allows when the organization role has the permission even though the global role lacks it', async () => {
      roleRows = [activeRole()];
      userRoleRows = [];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true)];
      permissionRows = [activePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasPermission(USER_ID, 'test', 'read')).toBe(false);
      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(true);
    });

    it('denies when the organization role permission is inactive', async () => {
      roleRows = [activeRole()];
      organizationRows = [organization(true)];
      membershipRows = [membership(ORG_ID, ROLE_ID, true)];
      permissionRows = [inactivePermission()];
      rolePermissionRows = [rolePermission(ROLE_ID, PERM_ID)];

      expect(await service.hasOrganizationPermission(USER_ID, ORG_ID, 'test', 'read')).toBe(false);
      expect(permissionRepository.findOne).not.toHaveBeenCalled();
    });
  });
});
