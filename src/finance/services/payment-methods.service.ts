import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentMethod } from '../entities/payment-method.entity';
import { AttachPaymentMethodDto } from '../dto/attach-payment-method.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { MembersService } from '../../members/services/members.service';

@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectRepository(PaymentMethod)
    private readonly repository: Repository<PaymentMethod>,
    private readonly tenantContextService: TenantContextService,
    private readonly membersService: MembersService,
  ) {}

  private async organizationId(): Promise<string> {
    const current = await this.tenantContextService.getCurrentOrganizationId();
    if (current) return current;
    const requested = await this.tenantContextService.getRequestedOrganizationId();
    if (!requested) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requested);
  }

  async attachPaymentMethod(memberId: string, dto: AttachPaymentMethodDto): Promise<PaymentMethod> {
    const organizationId = await this.organizationId();
    const member = await this.membersService.findOne(memberId);
    if (member.organization_id !== organizationId) throw new NotFoundException('Member not found');

    await this.repository.update(
      { organization_id: organizationId, member_id: memberId },
      { is_default: false },
    );
    const method = this.repository.create({
      organization_id: organizationId,
      member_id: memberId,
      stripe_customer_id: dto.stripe_customer_id,
      stripe_payment_method_id: dto.stripe_payment_method_id,
      is_default: true,
      card_brand: dto.card_brand,
      card_last4: dto.card_last4,
    });
    return this.repository.save(method);
  }

  async getDefaultPaymentMethod(memberId: string): Promise<PaymentMethod | null> {
    const organizationId = await this.organizationId();
    const member = await this.membersService.findOne(memberId);
    if (member.organization_id !== organizationId) throw new NotFoundException('Member not found');
    return this.repository.findOne({
      where: { organization_id: organizationId, member_id: memberId, is_default: true },
    });
  }

  /**
   * WORKER-ONLY lookup. The worker has no request tenant context; both values
   * come from a payment row that was itself loaded from an organization-scoped
   * worker batch. Keeping both predicates here prevents a member's method in
   * another organization from being selected.
   */
  async getDefaultPaymentMethodForOrganization(
    memberId: string,
    organizationId: string,
  ): Promise<PaymentMethod | null> {
    return this.repository.findOne({
      where: { organization_id: organizationId, member_id: memberId, is_default: true },
    });
  }
}