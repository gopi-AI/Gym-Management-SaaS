import { Repository } from 'typeorm';
import { TenantSettings } from '../entities/tenant-settings.entity';
export declare class TenantSettingsService {
    private readonly tenantSettingsRepository;
    constructor(tenantSettingsRepository: Repository<TenantSettings>);
    findOne(organizationId: string): Promise<TenantSettings | null>;
    create(organizationId: string, dto: {
        time_zone: string;
        locale: string;
        currency: string;
    }): Promise<TenantSettings>;
    update(organizationId: string, dto: {
        time_zone?: string;
        locale?: string;
        currency?: string;
    }): Promise<TenantSettings | null>;
}
//# sourceMappingURL=tenant-settings.service.d.ts.map