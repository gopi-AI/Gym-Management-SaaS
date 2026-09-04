import { BranchesService } from '../services/branches.service';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { Branch } from '../entities/branch.entity';
export declare class BranchesController {
    private readonly branchesService;
    constructor(branchesService: BranchesService);
    findAll(): Promise<Branch[]>;
    findOne(id: string): Promise<Branch | null>;
    create(dto: CreateBranchDto): Promise<Branch>;
    update(id: string, dto: UpdateBranchDto): Promise<Branch | null>;
}
export declare class OrganizationsBranchController {
    private readonly branchesService;
    constructor(branchesService: BranchesService);
    createBranchForOrganization(orgId: string, dto: CreateBranchDto): Promise<Branch>;
    findBranchesByOrganization(orgId: string): Promise<Branch[]>;
}
//# sourceMappingURL=branches.controller.d.ts.map