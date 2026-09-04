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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdentityRole = void 0;
const typeorm_1 = require("typeorm");
const identity_user_roles_entity_1 = require("./identity-user-roles.entity");
const identity_role_permissions_entity_1 = require("./identity-role-permissions.entity");
let IdentityRole = class IdentityRole {
};
exports.IdentityRole = IdentityRole;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], IdentityRole.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 50 }),
    __metadata("design:type", String)
], IdentityRole.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 255 }),
    __metadata("design:type", String)
], IdentityRole.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], IdentityRole.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], IdentityRole.prototype, "updated_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true }),
    __metadata("design:type", Boolean)
], IdentityRole.prototype, "is_active", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => identity_user_roles_entity_1.IdentityUserRole, (userRole) => userRole.role),
    __metadata("design:type", Array)
], IdentityRole.prototype, "userRoles", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => identity_role_permissions_entity_1.IdentityRolePermission, (rolePermission) => rolePermission.role),
    __metadata("design:type", Array)
], IdentityRole.prototype, "rolePermissions", void 0);
exports.IdentityRole = IdentityRole = __decorate([
    (0, typeorm_1.Entity)('IDENTITY_ROLES')
], IdentityRole);
//# sourceMappingURL=identity-roles.entity.js.map