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
exports.OrganizationsBranchController = exports.BranchesController = void 0;
const common_1 = require("@nestjs/common");
const branches_service_1 = require("../services/branches.service");
const create_branch_dto_1 = require("../dto/create-branch.dto");
const update_branch_dto_1 = require("../dto/update-branch.dto");
let BranchesController = class BranchesController {
    constructor(branchesService) {
        this.branchesService = branchesService;
    }
    async findAll() {
        return this.branchesService.findAll();
    }
    async findOne(id) {
        return this.branchesService.findOne(id);
    }
    async create(dto) {
        return this.branchesService.create(dto);
    }
    async update(id, dto) {
        return this.branchesService.update(id, dto);
    }
};
exports.BranchesController = BranchesController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BranchesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BranchesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_branch_dto_1.CreateBranchDto]),
    __metadata("design:returntype", Promise)
], BranchesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_branch_dto_1.UpdateBranchDto]),
    __metadata("design:returntype", Promise)
], BranchesController.prototype, "update", null);
exports.BranchesController = BranchesController = __decorate([
    (0, common_1.Controller)('v1/branches'),
    __metadata("design:paramtypes", [branches_service_1.BranchesService])
], BranchesController);
let OrganizationsBranchController = class OrganizationsBranchController {
    constructor(branchesService) {
        this.branchesService = branchesService;
    }
    async createBranchForOrganization(orgId, dto) {
        return this.branchesService.create({ ...dto, organization_id: orgId });
    }
    async findBranchesByOrganization(orgId) {
        return this.branchesService.findAll().then(branches => branches.filter(b => b.organization_id === orgId));
    }
};
exports.OrganizationsBranchController = OrganizationsBranchController;
__decorate([
    (0, common_1.Post)(':orgId/branches'),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Param)('orgId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_branch_dto_1.CreateBranchDto]),
    __metadata("design:returntype", Promise)
], OrganizationsBranchController.prototype, "createBranchForOrganization", null);
__decorate([
    (0, common_1.Get)(':orgId/branches'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('orgId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], OrganizationsBranchController.prototype, "findBranchesByOrganization", null);
exports.OrganizationsBranchController = OrganizationsBranchController = __decorate([
    (0, common_1.Controller)('v1/organizations'),
    __metadata("design:paramtypes", [branches_service_1.BranchesService])
], OrganizationsBranchController);
//# sourceMappingURL=branches.controller.js.map