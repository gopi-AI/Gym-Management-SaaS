import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { TenantSettings } from '../entities/tenant-settings.entity';
import { BranchSettings } from '../entities/branch-settings.entity';
import { BranchSettingsHistory } from '../entities/branch-settings-history.entity';

export class UpdateBranchSettingsDto {
  /**
   * All three fields are optional (PATCH semantics):
   * - omitted → override is cleared/ignored (left untouched, don't null the row)
   * - explicitly `null` → clear this override back to inherited from org
   */
  time_zone?: string | null;
  locale?: string | null;
  currency?: string | null;
}

export interface EffectiveSettings {
  time_zone: string | null;
  locale: string | null;
  currency: string | null;
}

export interface MergedBranchSettings {
  effective: EffectiveSettings;
  overrides: {
    time_zone: boolean;
    locale: boolean;
    currency: boolean;
  };
}

@Injectable()
export class BranchSettingsService {
  private readonly logger = new Logger(BranchSettingsService.name);

  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(BranchSettings)
    private readonly branchSettingsRepository: Repository<BranchSettings>,
    @InjectRepository(BranchSettingsHistory)
    private readonly branchSettingsHistoryRepository: Repository<BranchSettingsHistory>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepository: Repository<TenantSettings>,
  ) {}

  /**
   * Resolve the authorized org, confirm the branch exists and belongs to it,
   * then merge: branch override wins, else org TenantSettings, else null.
   * Returns both the effective values and a per-field override flag so the
   * consumer can render "override" vs "inherited" in a settings UI.
   */
  async getEffective(
    authorizedOrgId: string,
    branchId: string | null,
  ): Promise<MergedBranchSettings> {
    // Fallback to the org-wide tenant settings when there is no authorized
    // context (legacy or unauthenticated callers). Strictly org-scoped and
    // never trusts the client-supplied branch/org ids for authorization.
    const orgSettings = await this.tenantSettingsRepository.findOne({
      where: { organization_id: authorizedOrgId },
    });

    // When branchId is null (org-wide report), no branch override exists, so
    // fall through entirely to org settings.
    const branchRow = branchId
      ? await this.branchSettingsRepository.findOne({
          where: { branch_id: branchId, organization_id: authorizedOrgId },
        })
      : null;

    const effective: EffectiveSettings = {
      time_zone: branchRow?.time_zone ?? orgSettings?.time_zone ?? null,
      locale: branchRow?.locale ?? orgSettings?.locale ?? null,
      currency: branchRow?.currency ?? orgSettings?.currency ?? null,
    };

    const overrides = {
      time_zone: branchRow?.time_zone !== undefined,
      locale: branchRow?.locale !== undefined,
      currency: branchRow?.currency !== undefined,
    };

    return { effective, overrides };
  }

  async update(
    authorizedOrgId: string,
    branchId: string,
    dto: UpdateBranchSettingsDto,
    changedBy?: string | null,
  ): Promise<MergedBranchSettings> {
    // Ownership + authorization, verbatim from BranchesService.update():
    //   1. resolveAuthorizedOrg() (tenant-context, already established by the
    //      controller's requireOrganizationAccess guard)
    //   2. look up the branch scoped to that org; 404 if not found/owned.
    const orgId = authorizedOrgId;
    const branch = await this.branchRepository.findOne({
      where: { id: branchId, organization_id: orgId, is_active: true },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found or not owned by organization');
    }

    const previous = await this.branchSettingsRepository.findOne({
      where: { branch_id: branchId, organization_id: orgId },
    });

    // Build the partial replacement: only the fields present in the DTO.
    // Omitted fields are NOT touched (PATCH semantics, not PUT).
    const partial: Partial<BranchSettings> = {};
    if (dto.time_zone !== undefined) partial.time_zone = dto.time_zone;
    if (dto.locale !== undefined) partial.locale = dto.locale;
    if (dto.currency !== undefined) partial.currency = dto.currency;

    const updated = await this.branchSettingsRepository.save({
      // A brand-new row (no previous override) is created here on first call.
      branch_id: branchId,
      organization_id: orgId,
      ...partial,
    });

    // Diff against previous values FOR EXACTLY THE FIELDS THAT CHANGED.
    const delta = this.computeDelta(previous, updated);
    if (Object.keys(delta).length > 0) {
      await this.branchSettingsHistoryRepository.save({
        branch_id: branchId,
        organization_id: orgId,
        changed_by: changedBy ?? null,
        changes: delta,
      });
    }

    return this.getEffective(orgId, branchId);
  }

  private computeDelta(
    previous: BranchSettings | null,
    current: BranchSettings,
  ): Record<string, { from: unknown; to: unknown }> {
    const delta: Record<string, { from: unknown; to: unknown }> = {};
    const fields: Array<keyof BranchSettings> = [
      'time_zone',
      'locale',
      'currency',
    ];
    for (const field of fields) {
      const prev = previous?.[field] ?? null;
      const next = current[field] ?? null;
      if (!Object.is(prev, next)) {
        delta[field as string] = { from: prev, to: next };
      }
    }
    return delta;
  }
}
