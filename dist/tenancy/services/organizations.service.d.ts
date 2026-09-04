import { Repository } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
export declare class OrganizationsService {
    private readonly organizationRepository;
    private readonly tenantContextService;
    constructor(organizationRepository: Repository<Organization>, tenantContextService: TenantContextService);
    findAll(): Promise<Organization[]>;
    findOne(id: string): Promise<Organization | null>;
    create(dto: CreateOrganizationDto): Promise<Organization>;
    update(id: string, dto: UpdateOrganizationDto): Promise<Organization | null>;
    remove(id: string): Promise<void>;
    getCurrent(): Promise<Organization | null>;
}
//# sourceMappingURL=organizations.service.d.ts.map