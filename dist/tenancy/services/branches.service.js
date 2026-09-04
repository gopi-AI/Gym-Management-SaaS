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
exports.BranchesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const branch_entity_1 = require("../entities/branch.entity");
const organizations_service_1 = require("./organizations.service");
let BranchesService = class BranchesService {
    constructor(branchRepository, organizationsService) {
        this.branchRepository = branchRepository;
        this.organizationsService = organizationsService;
    }
    async findAll() {
        return this.branchRepository.find({
            where: { is_active: true },
            order: { name: 'ASC' },
        });
    }
    async findOne(id) {
        return this.branchRepository.findOne({
            where: { id, is_active: true },
        });
    }
    async create(dto) {
        // Validate organization exists
        await this.organizationsService.findOne(dto.organization_id);
        const branch = this.branchRepository.create({
            ...dto,
            is_active: dto.is_active ?? true,
        });
        return this.branchRepository.save(branch);
    }
    async update(id, dto) {
        await this.branchRepository.update(id, dto);
        return this.findOne(id);
    }
    async remove(id) {
        await this.branchRepository.update(id, { is_active: false });
    }
};
exports.BranchesService = BranchesService;
exports.BranchesService = BranchesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(branch_entity_1.Branch)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        organizations_service_1.OrganizationsService])
], BranchesService);
//# sourceMappingURL=branches.service.js.map