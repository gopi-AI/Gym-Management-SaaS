"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const identity_users_entity_1 = require("../entities/identity-users.entity");
const identity_roles_entity_1 = require("../entities/identity-roles.entity");
const identity_permissions_entity_1 = require("../entities/identity-permissions.entity");
const identity_user_roles_entity_1 = require("../entities/identity-user-roles.entity");
const identity_role_permissions_entity_1 = require("../entities/identity-role-permissions.entity");
let IdentityService = class IdentityService {
    constructor(userRepository, roleRepository, permissionRepository, userRoleRepository, rolePermissionRepository) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.userRoleRepository = userRoleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }
    async findUserByEmail(email) {
        return this.userRepository.findOne({
            where: { email, is_active: true },
        });
    }
    async findUserById(id) {
        return this.userRepository.findOne({
            where: { id, is_active: true },
        });
    }
    async findAllUsers() {
        return this.userRepository.find({
            where: { is_active: true },
            order: { created_at: 'DESC' },
        });
    }
    async createUser(dto) {
        const user = this.userRepository.create({
            ...dto,
            is_active: true,
            email_verified: false,
        });
        return this.userRepository.save(user);
    }
    async updateUser(id, updates) {
        await this.userRepository.update(id, updates);
        return this.findUserById(id);
    }
    async softDeleteUser(id) {
        await this.userRepository.update(id, { is_active: false });
    }
    // Role methods
    async findAllRoles() {
        return this.roleRepository.find({
            where: { is_active: true },
            order: { name: 'ASC' },
        });
    }
    async findRoleById(id) {
        return this.roleRepository.findOne({
            where: { id, is_active: true },
        });
    }
    async findRoleByName(name) {
        return this.roleRepository.findOne({
            where: { name, is_active: true },
        });
    }
    async createRole(dto) {
        const role = this.roleRepository.create(dto);
        return this.roleRepository.save(role);
    }
    async updateRole(id, dto) {
        await this.roleRepository.update(id, dto);
        return this.findRoleById(id);
    }
    // Permission methods
    async findAllPermissions() {
        return this.permissionRepository.find({
            where: { is_active: true },
            order: { name: 'ASC' },
        });
    }
    async findPermissionById(id) {
        return this.permissionRepository.findOne({
            where: { id, is_active: true },
        });
    }
    async findPermissionByResourceAndAction(resource, action) {
        return this.permissionRepository.findOne({
            where: { resource, action, is_active: true },
        });
    }
    async createPermission(dto) {
        const permission = this.permissionRepository.create(dto);
        return this.permissionRepository.save(permission);
    }
    // User-Role methods
    async assignRoleToUser(userId, roleId) {
        const userRole = this.userRoleRepository.create({ user_id: userId, role_id: roleId });
        return this.userRoleRepository.save(userRole);
    }
    async removeRoleFromUser(userId, roleId) {
        await this.userRoleRepository.delete({ user_id: userId, role_id: roleId });
    }
    async getUserRoles(userId) {
        const userRoles = await this.userRoleRepository.find({
            where: { user_id: userId },
            relations: ['role'],
        });
        return userRoles.map(ur => ur.role);
    }
    // Permission check
    async hasPermission(userId, resource, action) {
        // Get user's roles
        const userRoles = await this.userRoleRepository.find({
            where: { user_id: userId },
            relations: ['role'],
        });
        const roleIds = userRoles.map(ur => ur.role_id);
        if (roleIds.length === 0) {
            return false;
        }
        // Get permission IDs linked to those roles
        const rolePermissions = await this.rolePermissionRepository.find({
            where: { role_id: (0, typeorm_2.In)(roleIds) },
        });
        const permissionIds = rolePermissions.map(rp => rp.permission_id);
        if (permissionIds.length === 0) {
            return false;
        }
        // Check if any permission matches the required resource and action
        const permission = await this.permissionRepository.findOne({
            where: { id: (0, typeorm_2.In)(permissionIds), resource, action, is_active: true },
        });
        return !!permission;
    }
};
exports.IdentityService = IdentityService;
exports.IdentityService = IdentityService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(identity_users_entity_1.IdentityUser)),
    __param(1, (0, typeorm_1.InjectRepository)(identity_roles_entity_1.IdentityRole)),
    __param(2, (0, typeorm_1.InjectRepository)(identity_permissions_entity_1.IdentityPermission)),
    __param(3, (0, typeorm_1.InjectRepository)(identity_user_roles_entity_1.IdentityUserRole)),
    __param(4, (0, typeorm_1.InjectRepository)(identity_role_permissions_entity_1.IdentityRolePermission)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository])
], IdentityService);
//# sourceMappingURL=identity.service.js.map