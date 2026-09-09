import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSettings } from '../entities/tenant-settings.entity';

@Injectable()
export class TenantSettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepository: Repository<TenantSettings>,
  ) {}

  async findOne(organizationId: string): Promise<TenantSettings | null> {
    return this.tenantSettingsRepository.findOne({
      where: { organization_id: organizationId },
    });
  }

  async create(organizationId: string, dto: {
    time_zone: string;
    locale: string;
    currency: string;
  }): Promise<TenantSettings> {
    const settings = this.tenantSettingsRepository.create({
      organization_id: organizationId,
      ...dto,
      is_active: true,
    });
    return this.tenantSettingsRepository.save(settings);
  }

  async update(organizationId: string, dto: {
    time_zone?: string;
    locale?: string;
    currency?: string;
  }): Promise<TenantSettings | null> {
    await this.tenantSettingsRepository.update(
      { organization_id: organizationId },
      dto,
    );
    return this.findOne(organizationId);
  }
}