import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { OrganizationsService } from './organizations.service';
export declare class BranchesService {
    private readonly branchRepository;
    private readonly organizationsService;
    constructor(branchRepository: Repository<Branch>, organizationsService: OrganizationsService);
    findAll(): Promise<Branch[]>;
    findOne(id: string): Promise<Branch | null>;
    create(dto: CreateBranchDto): Promise<Branch>;
    update(id: string, dto: UpdateBranchDto): Promise<Branch | null>;
    remove(id: string): Promise<void>;
}
//# sourceMappingURL=branches.service.d.ts.map