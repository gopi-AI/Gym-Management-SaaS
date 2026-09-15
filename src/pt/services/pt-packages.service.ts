import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PTPackage } from '../entities/pt-package.entity';
import { CreatePtPackageDto } from '../dto/create-pt-package.dto';
import { toMoney } from '../pt.constants';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OrganizationsService } from '../../tenancy/services/organizations.service';

/**
 * Single legal write path for `PTPackage` rows.
 *
 * `create()` is the only method that writes a package; nothing else in the
 * codebase (or in another module) constructs a `PTPackage` row.
 */
@Injectable()
export class PtPackagesService {
  constructor(
    @InjectRepository(PTPackage)
    private readonly packageRepository: Repository<PTPackage>,
    private readonly tenantContextService: TenantContextService,
    private readonly organizationsService: OrganizationsService,
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

  /**
   * Create a PT package (§12 Q4).
   *
   * - `price` is stored pre-tax (NET). No tax fields, no tax logic (Phase 3).
   * - `currency` is optional on input and defaults to the ORGANIZATION's
   *   currency, read once at creation and then STORED on the row — it is never
   *   inferred at read time.
   * - `commission_percent` is the package-level default used by
   *   `TrainerCommission` at enrollment time; null means "no package default".
   */
  async create(dto: CreatePtPackageDto): Promise<PTPackage> {
    const organizationId = await this.getOrganizationId();

    if (dto.valid_from && dto.valid_to && dto.valid_to < dto.valid_from) {
      throw new BadRequestException('valid_to must not be before valid_from');
    }

    const currency = dto.currency
      ? dto.currency.toUpperCase()
      : await this.resolveOrganizationCurrency(organizationId);

    const pkg = this.packageRepository.create({
      organization_id: organizationId,
      name: dto.name,
      description: dto.description ?? null,
      session_count: dto.session_count,
      price: toMoney(dto.price),
      currency,
      commission_percent:
        dto.commission_percent === undefined
          ? null
          : toMoney(dto.commission_percent),
      valid_from: dto.valid_from ?? null,
      valid_to: dto.valid_to ?? null,
      is_active: dto.is_active ?? true,
    });

    return this.packageRepository.save(pkg);
  }

  async findAll(): Promise<PTPackage[]> {
    const organizationId = await this.getOrganizationId();
    return this.packageRepository.find({
      where: { organization_id: organizationId, is_active: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<PTPackage> {
    const organizationId = await this.getOrganizationId();
    const pkg = await this.packageRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!pkg) {
      throw new NotFoundException('PTPackage not found');
    }
    return pkg;
  }

  /** The organization's default currency, used only as the creation-time default. */
  private async resolveOrganizationCurrency(
    organizationId: string,
  ): Promise<string> {
    const organization = await this.organizationsService.findOne(organizationId);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization.currency;
  }
}