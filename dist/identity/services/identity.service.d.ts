import { Repository } from 'typeorm';
import { IdentityUser } from '../entities/identity-users.entity';
import { IdentityRole } from '../entities/identity-roles.entity';
import { IdentityPermission } from '../entities/identity-permissions.entity';
import { IdentityUserRole } from '../entities/identity-user-roles.entity';
import { IdentityRolePermission } from '../entities/identity-role-permissions.entity';
export declare class IdentityService {
    private readonly userRepository;
    private readonly roleRepository;
    private readonly permissionRepository;
    private readonly userRoleRepository;
    private readonly rolePermissionRepository;
    constructor(userRepository: Repository<IdentityUser>, roleRepository: Repository<IdentityRole>, permissionRepository: Repository<IdentityPermission>, userRoleRepository: Repository<IdentityUserRole>, rolePermissionRepository: Repository<IdentityRolePermission>);
    findUserByEmail(email: string): Promise<IdentityUser | null>;
    findUserById(id: string): Promise<IdentityUser | null>;
    findAllUsers(): Promise<IdentityUser[]>;
    createUser(dto: {
        email: string;
        passwordHash: string;
        firstName: string;
        lastName: string;
        phone?: string;
    }): Promise<IdentityUser>;
    updateUser(id: string, updates: Partial<IdentityUser>): Promise<IdentityUser | null>;
    softDeleteUser(id: string): Promise<void>;
    findAllRoles(): Promise<IdentityRole[]>;
    findRoleById(id: string): Promise<IdentityRole | null>;
    findRoleByName(name: string): Promise<IdentityRole | null>;
    createRole(dto: {
        name: string;
        description?: string;
    }): Promise<IdentityRole>;
    updateRole(id: string, dto: {
        name?: string;
        description?: string;
    }): Promise<IdentityRole | null>;
    findAllPermissions(): Promise<IdentityPermission[]>;
    findPermissionById(id: string): Promise<IdentityPermission | null>;
    findPermissionByResourceAndAction(resource: string, action: string): Promise<IdentityPermission | null>;
    createPermission(dto: {
        name: string;
        description: string;
        resource: string;
        action: string;
    }): Promise<IdentityPermission>;
    assignRoleToUser(userId: string, roleId: string): Promise<IdentityUserRole>;
    removeRoleFromUser(userId: string, roleId: string): Promise<void>;
    getUserRoles(userId: string): Promise<IdentityRole[]>;
    hasPermission(userId: string, resource: string, action: string): Promise<boolean>;
}
//# sourceMappingURL=identity.service.d.ts.map