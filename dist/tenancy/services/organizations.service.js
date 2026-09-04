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
exports.OrganizationsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const organization_entity_1 = require("../entities/organization.entity");
const tenant_context_service_1 = require("../../shared/tenant/tenant-context.service");
let OrganizationsService = class OrganizationsService {
    constructor(organizationRepository, tenantContextService) {
        this.organizationRepository = organizationRepository;
        this.tenantContextService = tenantContextService;
    }
    async findAll() {
        return this.organizationRepository.find({
            where: { is_active: true },
            order: { name: 'ASC' },
        });
    }
    async findOne(id) {
        return this.organizationRepository.findOne({
            where: { id, is_active: true },
        });
    }
    async create(dto) {
        const organization = this.organizationRepository.create({
            ...dto,
            is_active: dto.is_active ?? true,
        });
        const saved = await this.organizationRepository.save(organization);
        return Array.isArray(saved) ? saved[0] : saved;
    }
    async update(id, dto) {
        await this.organizationRepository.update(id, dto);
        return this.findOne(id);
    }
    async remove(id) {
        await this.organizationRepository.update(id, { is_active: false });
    }
    async getCurrent() {
        const orgId = await this.tenantContextService.getCurrentOrganizationId();
        if (!orgId) {
            return null;
        }
        return this.findOne(orgId);
    }
};
exports.OrganizationsService = OrganizationsService;
exports.OrganizationsService = OrganizationsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(organization_entity_1.Organization)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        tenant_context_service_1.TenantContextService])
], OrganizationsService);
//# sourceMappingURL=organizations.service.js.map