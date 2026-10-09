import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoyaltyAccount } from '../entities/loyalty-account.entity';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

/**
 * Read-only service for the loyalty points tab (Phase 2, P2-08).
 *
 * Route layer wiring: exposes the loyalty ledger (accounts + transactions) over
 * HTTP for the Member 360 loyalty tab. No writes are performed here — every
 * read is org-scoped through `TenantContextService`.
 */
@Injectable()
export class LoyaltyReadService {
  constructor(
    @InjectRepository(LoyaltyAccount)
    private readonly accountRepository: Repository<LoyaltyAccount>,
    @InjectRepository(LoyaltyTransaction)
    private readonly transactionRepository: Repository<LoyaltyTransaction>,
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

  async findAccountByMemberId(
    memberId: string,
  ): Promise<LoyaltyAccount> {
    const orgId = await this.getOrganizationId();
    const account = await this.accountRepository.findOne({
      where: { organization_id: orgId, member_id: memberId },
    });
    if (!account) {
      throw new NotFoundException('Loyalty account not found');
    }
    return account;
  }

  async findAllTransactionsByMemberId(
    memberId: string,
  ): Promise<LoyaltyTransaction[]> {
    const orgId = await this.getOrganizationId();
    const account = await this.accountRepository.findOne({
      where: { organization_id: orgId, member_id: memberId },
    });
    if (!account) {
      throw new NotFoundException('Loyalty account not found');
    }
    return this.transactionRepository.find({
      where: { account_id: account.id },
      order: { created_at: 'DESC' },
    });
  }
}