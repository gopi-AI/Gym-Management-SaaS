import { IdentityRolePermission } from './identity-role-permissions.entity';
export declare class IdentityPermission {
    id: string;
    name: string;
    description: string;
    resource: string;
    action: string;
    created_at: Date;
    updated_at: Date;
    is_active: boolean;
    rolePermissions: IdentityRolePermission[];
}
//# sourceMappingURL=identity-permissions.entity.d.ts.map