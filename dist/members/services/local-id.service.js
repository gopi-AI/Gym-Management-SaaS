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
exports.LocalIdService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const local_id_counter_entity_1 = require("../entities/local-id-counter.entity");
let LocalIdService = class LocalIdService {
    constructor(counterRepository, dataSource) {
        this.counterRepository = counterRepository;
        this.dataSource = dataSource;
    }
    /**
     * Generate the next unique local_id for a given organization.
     * Uses a transaction with row-level locking to prevent race conditions.
     */
    async nextLocalId(organizationId) {
        return this.dataSource.transaction(async (manager) => {
            const repo = manager.getRepository(local_id_counter_entity_1.LocalIdCounter);
            let counter = await repo.findOne({
                where: { organization_id: organizationId },
                lock: { mode: 'pessimistic_write' },
            });
            if (!counter) {
                counter = repo.create({
                    organization_id: organizationId,
                    last_local_id: 0,
                });
                counter = await repo.save(counter);
            }
            counter.last_local_id += 1;
            await repo.save(counter);
            return counter.last_local_id;
        });
    }
};
exports.LocalIdService = LocalIdService;
exports.LocalIdService = LocalIdService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(local_id_counter_entity_1.LocalIdCounter)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.DataSource])
], LocalIdService);
//# sourceMappingURL=local-id.service.js.map