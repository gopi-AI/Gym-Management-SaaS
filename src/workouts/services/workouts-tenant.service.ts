import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Member } from '../../members/entities/member.entity';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

/**
 * Tenant/member resolution shared by every Workouts service.
 *
 * Workouts reads the `MEMBERS_MEMBERS` row only to prove that the member named
 * in the route belongs to the authorized organization. It never writes member
 * data and does not duplicate the Members module's service logic; the
 * repository read is deliberately used instead of importing `MembersModule`,
 * because `MembersModule` already imports `WorkoutsModule` (Member 360) and a
 * service import would create a module cycle.
 */
@Injectable()
export class WorkoutsTenantService {
  constructor(
    private readonly tenantContextService: TenantContextService,
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
  ) {}

  /**
   * Resolve the authorized organization for the current request.
   *
   * Matches the fallback every tenant-scoped module uses: the requested org is
   * recorded by the interceptor, and `requireOrganizationAccess` performs the
   * authoritative membership check.
   */
  async getOrganizationId(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
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
   * The authenticated user id from the verified JWT. Used for audit columns
   * (`assigned_by`, `reviewed_by`, `deleted_by`, `submitted_by`).
   */
  async getCurrentUserId(): Promise<string> {
    return this.tenantContextService.assertAuthenticated();
  }

  /**
   * Prove the member exists, is active, and belongs to the authorized org.
   * Missing and cross-org members answer the same 404.
   */
  async requireMemberInOrganization(
    memberId: string,
    organizationId: string,
  ): Promise<Member> {
    const member = await this.memberRepository.findOne({
      where: {
        id: memberId,
        organization_id: organizationId,
        is_active: true,
      },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }
}
