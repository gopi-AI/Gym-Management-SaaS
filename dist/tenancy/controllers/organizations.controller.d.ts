import { OrganizationsService } from '../services/organizations.service';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { Organization } from '../entities/organization.entity';
export declare class OrganizationsController {
    private readonly organizationsService;
    constructor(organizationsService: OrganizationsService);
    findAll(): Promise<Organization[]>;
    findOne(id: string): Promise<Organization | null>;
    create(dto: CreateOrganizationDto): Promise<Organization>;
    update(id: string, dto: UpdateOrganizationDto): Promise<Organization | null>;
}
//# sourceMappingURL=organizations.controller.d.ts.map