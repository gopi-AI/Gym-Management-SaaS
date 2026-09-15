import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonalTrainer } from '../entities/personal-trainer.entity';
import { CreatePersonalTrainerDto } from '../dto/create-personal-trainer.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

/**
 * Single legal write path for `PersonalTrainer` rows.
 *
 * Org-scoping mirrors `MembersService`: every read filters on
 * `organization_id`, and `create()` refuses a branch that does not belong to the
 * authorized organization (reusing `TenantContextService.validateBranchAccess`,
 * exactly like `MembersService.ensureBranchBelongsToOrg`).
 */
@Injectable()
export class PersonalTrainersService {
  constructor(
    @InjectRepository(PersonalTrainer)
    private readonly trainerRepository: Repository<PersonalTrainer>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId =
      await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId =
      await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  async create(dto: CreatePersonalTrainerDto): Promise<PersonalTrainer> {
    const organizationId = await this.getOrganizationId();

    const branchOk = await this.tenantContextService.validateBranchAccess(
      organizationId,
      dto.branch_id,
    );
    if (!branchOk) {
      throw new BadRequestException(
        'Branch does not belong to the authorized organization',
      );
    }

    const trainer = this.trainerRepository.create({
      organization_id: organizationId,
      branch_id: dto.branch_id,
      user_id: dto.user_id ?? null,
      first_name: dto.first_name,
      last_name: dto.last_name,
      specialty: dto.specialty ?? null,
      certification: dto.certification ?? null,
      hire_date: dto.hire_date ?? null,
      is_active: dto.is_active ?? true,
    });

    return this.trainerRepository.save(trainer);
  }

  async findAll(): Promise<PersonalTrainer[]> {
    const organizationId = await this.getOrganizationId();
    return this.trainerRepository.find({
      where: { organization_id: organizationId, is_active: true },
      order: { last_name: 'ASC', first_name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<PersonalTrainer> {
    const organizationId = await this.getOrganizationId();
    const trainer = await this.trainerRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!trainer) {
      throw new NotFoundException('PersonalTrainer not found');
    }
    return trainer;
  }
}