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
exports.MembersService = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const member_entity_1 = require("../entities/member.entity");
const local_id_service_1 = require("./local-id.service");
const tenant_context_service_1 = require("../../shared/tenant/tenant-context.service");
const outbox_service_1 = require("../../shared/outbox/outbox.service");
let MembersService = class MembersService {
    constructor(memberRepository, dataSource, localIdService, tenantContextService, outboxService) {
        this.memberRepository = memberRepository;
        this.dataSource = dataSource;
        this.localIdService = localIdService;
        this.tenantContextService = tenantContextService;
        this.outboxService = outboxService;
    }
    async getOrganizationId() {
        const orgId = await this.tenantContextService.getCurrentOrganizationId();
        if (!orgId) {
            throw new common_1.NotFoundException('Organization context not found');
        }
        return orgId;
    }
    async findAll(query) {
        const organizationId = await this.getOrganizationId();
        const page = query.page || 1;
        const limit = query.limit || 20;
        const skip = (page - 1) * limit;
        const where = { organization_id: organizationId, is_active: true };
        if (query.branch_id) {
            where.branch_id = query.branch_id;
        }
        if (query.search) {
            where.first_name = (0, typeorm_2.Like)(`%${query.search}%`);
        }
        const [data, total] = await this.memberRepository.findAndCount({
            where,
            order: { created_at: 'DESC' },
            take: limit,
            skip,
        });
        return { data, total, page, limit };
    }
    async findOne(id) {
        const organizationId = await this.getOrganizationId();
        const member = await this.memberRepository.findOne({
            where: { id, organization_id: organizationId, is_active: true },
        });
        if (!member) {
            throw new common_1.NotFoundException('Member not found');
        }
        return member;
    }
    async findByLocalId(localId) {
        const organizationId = await this.getOrganizationId();
        return this.memberRepository.findOne({
            where: { local_id: localId, organization_id: organizationId, is_active: true },
        });
    }
    async ensureNoDuplicateContact(dto, organizationId, excludeId) {
        const orConditions = [];
        if (dto.email) {
            orConditions.push({ email: dto.email });
        }
        if (dto.phone) {
            orConditions.push({ phone: dto.phone });
        }
        if (orConditions.length === 0) {
            return;
        }
        const existing = await this.memberRepository.findOne({
            where: orConditions.map((condition) => ({ ...condition, organization_id: organizationId, is_active: true })),
        });
        if (existing && (!excludeId || existing.id !== excludeId)) {
            throw new common_1.BadRequestException('A member with this email or phone already exists in the organization');
        }
    }
    async create(dto) {
        const organizationId = await this.getOrganizationId();
        const branchId = dto.branch_id || (await this.tenantContextService.getCurrentBranchId()) || '';
        await this.ensureNoDuplicateContact(dto, organizationId);
        return this.dataSource.transaction(async (manager) => {
            const localId = await this.localIdService.nextLocalId(organizationId);
            const globalUuid = (0, crypto_1.randomUUID)();
            const memberRepo = manager.getRepository(member_entity_1.Member);
            const member = memberRepo.create({
                ...dto,
                organization_id: organizationId,
                branch_id: branchId,
                global_uuid: globalUuid,
                local_id: localId,
                date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
                is_active: true,
            });
            const saved = await memberRepo.save(member);
            await this.outboxService.saveEvent('MEMBER_CREATED', JSON.stringify({ memberId: saved.id, localId: saved.local_id, organizationId }), saved.global_uuid);
            return saved;
        });
    }
    async update(id, dto) {
        const organizationId = await this.getOrganizationId();
        const member = await this.memberRepository.findOne({
            where: { id, organization_id: organizationId, is_active: true },
        });
        if (!member) {
            throw new common_1.NotFoundException('Member not found');
        }
        await this.ensureNoDuplicateContact(dto, organizationId, id);
        const updates = {
            ...dto,
            date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : member.date_of_birth,
        };
        await this.memberRepository.update(id, updates);
        await this.outboxService.saveEvent('MEMBER_UPDATED', JSON.stringify({ memberId: id, organizationId }), member.global_uuid);
        return this.findOne(id);
    }
    async softDelete(id) {
        const organizationId = await this.getOrganizationId();
        const member = await this.memberRepository.findOne({
            where: { id, organization_id: organizationId, is_active: true },
        });
        if (!member) {
            throw new common_1.NotFoundException('Member not found');
        }
        const result = await this.memberRepository.update({ id, organization_id: organizationId, is_active: true }, { is_active: false });
        if (result.affected === 0) {
            throw new common_1.NotFoundException('Member not found');
        }
        await this.outboxService.saveEvent('MEMBER_DEACTIVATED', JSON.stringify({ memberId: id, organizationId }), member.global_uuid);
    }
};
exports.MembersService = MembersService;
exports.MembersService = MembersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(member_entity_1.Member)),
    __param(1, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.DataSource,
        local_id_service_1.LocalIdService,
        tenant_context_service_1.TenantContextService,
        outbox_service_1.OutboxService])
], MembersService);
//# sourceMappingURL=members.service.js.map