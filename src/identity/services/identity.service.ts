import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { IdentityUser } from '../entities/identity-users.entity';
import { IdentityRole } from '../entities/identity-roles.entity';
import { IdentityPermission } from '../entities/identity-permissions.entity';
import { IdentityUserRole } from '../entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../entities/identity-role-permissions.entity';
import { IdentityUserOrganization } from '../entities/identity-user-organizations.entity';

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(IdentityUser)
    private readonly userRepository: Repository<IdentityUser>,
    @InjectRepository(IdentityRole)
    private readonly roleRepository: Repository<IdentityRole>,
    @InjectRepository(IdentityPermission)
    private readonly permissionRepository: Repository<IdentityPermission>,
    @InjectRepository(IdentityUserRole)
    private readonly userRoleRepository: Repository<IdentityUserRole>,
    @InjectRepository(IdentityRolePermission)
    private readonly rolePermissionRepository: Repository<IdentityRolePermission>,
    @InjectRepository(IdentityUserOrganization)
    private readonly userOrganizationRepository: Repository<IdentityUserOrganization>,
  ) {}

  async findUserByEmail(email: string): Promise<IdentityUser | null> {
    return this.userRepository.findOne({
      where: { email, is_active: true },
    });
  }

  async findUserById(id: string): Promise<IdentityUser | null> {
    return this.userRepository.findOne({
      where: { id, is_active: true },
    });
  }

  async findAllUsers(): Promise<IdentityUser[]> {
    return this.userRepository.find({
      where: { is_active: true },
      order: { created_at: 'DESC' },
    });
  }

  async createUser(dto: { email: string; passwordHash: string; firstName: string; lastName: string; phone?: string }): Promise<IdentityUser> {
    const user = this.userRepository.create({
      email: dto.email,
      password_hash: dto.passwordHash,
      first_name: dto.firstName,
      last_name: dto.lastName,
      phone: dto.phone,
      is_active: true,
      email_verified: false,
    });
    return this.userRepository.save(user);
  }

  async updateUser(id: string, updates: Partial<IdentityUser>): Promise<IdentityUser | null> {
    await this.userRepository.update(id, updates);
    return this.findUserById(id);
  }

  async softDeleteUser(id: string): Promise<void> {
    await this.userRepository.update(id, { is_active: false });
  }

  // Role methods

  async findAllRoles(): Promise<IdentityRole[]> {
    return this.roleRepository.find({
      where: { is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findRoleById(id: string): Promise<IdentityRole | null> {
    return this.roleRepository.findOne({
      where: { id, is_active: true },
    });
  }

  async findRoleByName(name: string): Promise<IdentityRole | null> {
    return this.roleRepository.findOne({
      where: { name, is_active: true },
    });
  }

  async createRole(dto: { name: string; description?: string }): Promise<IdentityRole> {
    const role = this.roleRepository.create(dto);
    return this.roleRepository.save(role);
  }

  async updateRole(id: string, dto: { name?: string; description?: string }): Promise<IdentityRole | null> {
    await this.roleRepository.update(id, dto);
    return this.findRoleById(id);
  }

  // Permission methods

  async findAllPermissions(): Promise<IdentityPermission[]> {
    return this.permissionRepository.find({
      where: { is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findPermissionById(id: string): Promise<IdentityPermission | null> {
    return this.permissionRepository.findOne({
      where: { id, is_active: true },
    });
  }

  async findPermissionByResourceAndAction(resource: string, action: string): Promise<IdentityPermission | null> {
    return this.permissionRepository.findOne({
      where: { resource, action, is_active: true },
    });
  }

  async createPermission(dto: { name: string; description: string; resource: string; action: string }): Promise<IdentityPermission> {
    const permission = this.permissionRepository.create(dto);
    return this.permissionRepository.save(permission);
  }

  // User-Role methods

  async assignRoleToUser(userId: string, roleId: string): Promise<IdentityUserRole> {
    const userRole = this.userRoleRepository.create({ user_id: userId, role_id: roleId });
    return this.userRoleRepository.save(userRole);
  }

  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await this.userRoleRepository.delete({ user_id: userId, role_id: roleId });
  }

  async getUserRoles(userId: string): Promise<IdentityRole[]> {
    const userRoles = await this.userRoleRepository.find({
      where: { user_id: userId },
      relations: ['role'],
    });
    return userRoles.map(ur => ur.role);
  }

  // Permission check

  async hasPermission(userId: string, resource: string, action: string): Promise<boolean> {
    // Get user's roles, including the role relation so we can enforce
    // active-state on both the role and its permissions.
    const userRoles = await this.userRoleRepository.find({
      where: { user_id: userId },
      relations: ['role'],
    });
    // Inactive roles must not grant access.
    const activeRoleIds = userRoles
      .filter(ur => ur.role?.is_active === true)
      .map(ur => ur.role_id);
    if (activeRoleIds.length === 0) {
      return false;
    }

    // Get permission IDs linked to those active roles, including the
    // permission relation so we can enforce active-state on permissions.
    const rolePermissions = await this.rolePermissionRepository.find({
      where: { role_id: In(activeRoleIds) },
      relations: ['permission'],
    });
    // Inactive permissions must not grant access.
    const activePermissionIds = rolePermissions
      .filter(rp => rp.permission?.is_active === true)
      .map(rp => rp.permission_id);
    if (activePermissionIds.length === 0) {
      return false;
    }

    // Check if any active permission matches the required resource and action.
    const permission = await this.permissionRepository.findOne({
      where: { id: In(activePermissionIds), resource, action, is_active: true },
    });

    return !!permission;
  }

  /**
   * Organization-scoped permission check. The user must have an ACTIVE
   * membership in the requested organization, that organization must itself be
   * ACTIVE, that membership must reference an ACTIVE organization-level role,
   * and that role must grant an ACTIVE permission matching the required
   * resource and action.
   *
   * No fallback to the user's global roles or global permissions is allowed.
   * A permission granted globally does not compensate for a missing permission
   * in the organization role, and an organization permission does not require
   * the same permission to exist globally.
   */
  async hasOrganizationPermission(
    userId: string,
    organizationId: string,
    resource: string,
    action: string,
  ): Promise<boolean> {
    // 1. Active membership in the requested organization is required.
    const membership = await this.userOrganizationRepository.findOne({
      where: {
        user_id: userId,
        organization_id: organizationId,
        is_active: true,
      },
      relations: ['organization', 'role'],
    });
    if (!membership) return false;

    // 2. A membership in a DEACTIVATED organization does not authorize, even if
    // the membership row, its role and the permission are all still active.
    if (membership.organization?.is_active !== true) return false;

    // 3. A membership with a null role denies access.
    if (!membership.role_id || !membership.role) return false;

    // 4. The organization role must be active.
    if (!membership.role.is_active) return false;

    // 5. Check the organization role's permissions (no global fallback).
    const rolePermissions = await this.rolePermissionRepository.find({
      where: { role_id: membership.role_id },
      relations: ['permission'],
    });
    const activePermissionIds = rolePermissions
      .filter(rp => rp.permission?.is_active === true)
      .map(rp => rp.permission_id);
    if (activePermissionIds.length === 0) return false;

    const permission = await this.permissionRepository.findOne({
      where: { id: In(activePermissionIds), resource, action, is_active: true },
    });

    return !!permission;
  }

  // Organization membership (Correction #10a)

  /**
   * Assign a user to an organization (active membership), optionally with an
   * organization-level role. Throws/relies on the unique constraint
   * (user_id, organization_id) to prevent duplicate active memberships.
   */
  async assignUserToOrganization(
    userId: string,
    organizationId: string,
    roleId?: string,
  ): Promise<IdentityUserOrganization> {
    const membership = this.userOrganizationRepository.create({
      user_id: userId,
      organization_id: organizationId,
      role_id: roleId ?? null,
      is_active: true,
    });
    return this.userOrganizationRepository.save(membership);
  }

  /**
   * Return all active organization memberships for a user, including the
   * organization and optional role relations.
   */
  async getUserOrganizations(userId: string): Promise<IdentityUserOrganization[]> {
    return this.userOrganizationRepository.find({
      where: { user_id: userId, is_active: true },
      relations: ['organization', 'role'],
    });
  }

  /**
   * Determine whether a user has an ACTIVE membership in the given
   * organization. This is the authoritative tenant-authorization check used
   * by the tenant-context enforcement (Correction #10).
   */
  async isUserInOrganization(userId: string, organizationId: string): Promise<boolean> {
    const membership = await this.userOrganizationRepository.findOne({
      where: { user_id: userId, organization_id: organizationId, is_active: true },
    });
    return !!membership;
  }

  /**
   * Deactivate a user's membership in an organization (soft-delete semantics).
   */
  async disableOrganizationMembership(userId: string, organizationId: string): Promise<void> {
    await this.userOrganizationRepository.update(
      { user_id: userId, organization_id: organizationId, is_active: true },
      { is_active: false },
    );
  }
}