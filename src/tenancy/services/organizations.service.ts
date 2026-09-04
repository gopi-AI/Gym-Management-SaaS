import { Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { CreateOrganizationDto } from '../dto/create-organization.dto';
import { UpdateOrganizationDto } from '../dto/update-organization.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async findAll(): Promise<Organization[]> {
    return this.organizationRepository.find({
      where: { is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Organization | null> {
    return this.organizationRepository.findOne({
      where: { id, is_active: true },
    });
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    const organization = this.organizationRepository.create({
      ...dto,
      is_active: dto.is_active ?? true,
    });
    const saved = await this.organizationRepository.save(organization);
    return Array.isArray(saved) ? saved[0] : saved;
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization | null> {
    await this.organizationRepository.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.organizationRepository.update(id, { is_active: false });
  }

  async getCurrent(): Promise<Organization | null> {
    const orgId = await this.tenantContextService.getCurrentOrganizationId();
    if (!orgId) {
      return null;
    }
    return this.findOne(orgId);
  }
}