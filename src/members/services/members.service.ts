import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { Member } from '../entities/member.entity';
import { MemberProfile } from '../entities/member-profile.entity';
import { OutboxEntity } from '../../shared/outbox/outbox.entity';
import { CreateMemberDto } from '../dto/create-member.dto';
import { UpdateMemberDto } from '../dto/update-member.dto';
import { ListMembersDto } from '../dto/list-members.dto';
import { LocalIdService } from './local-id.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(Member)
    private readonly memberRepository: Repository<Member>,
    @InjectRepository(MemberProfile)
    private readonly memberProfileRepository: Repository<MemberProfile>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly localIdService: LocalIdService,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

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

  async findAll(query: ListMembersDto): Promise<{ data: Member[]; total: number; page: number; limit: number }> {
    const organizationId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { organization_id: organizationId, is_active: true };

    if (query.branch_id) {
      where.branch_id = query.branch_id;
    }

    if (query.search) {
      where.first_name = Like(`%${query.search}%`);
    }

    const [data, total] = await this.memberRepository.findAndCount({
      where,
      order: { created_at: 'DESC' },
      take: limit,
      skip,
    });

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Member> {
    const organizationId = await this.getOrganizationId();
    const member = await this.memberRepository.findOne({
      where: { id, organization_id: organizationId, is_active: true },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    return member;
  }

  async findByLocalId(localId: number): Promise<Member | null> {
    const organizationId = await this.getOrganizationId();
    return this.memberRepository.findOne({
      where: { local_id: localId, organization_id: organizationId, is_active: true },
    });
  }

  /**
   * Get a member's profile (current health/metrics), org-scoped.
   *
   * `MemberProfile.weight`, `body_fat` and `height` are the LATEST-VALUE cache —
   * denormalized from the most recent `MeasurementLog` row by the dual-write path in
   * `MeasurementLogsService.create()` (§12 Q13). The Member 360 header reads these
   * cached current values here (O(1)) rather than re-querying the time-series
   * table on every header load.
   *
   * Returns `null` when the member has no profile row yet (a null/empty state, not
   * an error — the 360 header surfaces it as such).
   */
  /**
   * Get a member's profile (current health/metrics), org-scoped.
   *
   * `MemberProfile.weight`, `body_fat` and `height` are the LATEST-VALUE cache —
   * denormalized from the most recent `MeasurementLog` row by the dual-write path in
   * `MeasurementLogsService.create()` (§12 Q13). The Member 360 header reads these
   * cached current values here (O(1)) rather than re-querying the time-series
   * table on every header load.
   *
   * Returns `null` when the member has no profile row yet (a null/empty state, not
   * an error — the 360 header surfaces it as such).
   *
   * Org-scoping is implicit: `findOne(memberId)` throws NotFoundException when the
   * member doesn't belong to the caller's org, so a cross-org member id cannot leak
   * the profile.
   */
  async getProfile(memberId: string): Promise<MemberProfile | null> {
    await this.findOne(memberId);
    return this.memberProfileRepository.findOne({
      where: { member_id: memberId },
    });
  }

  private async ensureNoDuplicateContact(
    dto: CreateMemberDto | UpdateMemberDto,
    organizationId: string,
    excludeId?: string,
  ): Promise<void> {
    const orConditions: any[] = [];
    if (dto.email) {
      orConditions.push({ email: dto.email });
    }
    if (dto.phone) {
      orConditions.push({ phone: dto.phone });
    }

    if (orConditions.length === 0) {
      return;
    }

    const existing = await this.memberRepository.findOne({
      where: orConditions.map((condition) => ({ ...condition, organization_id: organizationId, is_active: true })),
    });

    if (existing && (!excludeId || existing.id !== excludeId)) {
      throw new BadRequestException('A member with this email or phone already exists in the organization');
    }
  }

  private async ensureBranchBelongsToOrg(
    organizationId: string,
    branchId?: string,
  ): Promise<void> {
    if (!branchId) {
      return;
    }
    const ok = await this.tenantContextService.validateBranchAccess(organizationId, branchId);
    if (!ok) {
      throw new BadRequestException('Branch does not belong to the authorized organization');
    }
  }

  async create(dto: CreateMemberDto): Promise<Member> {
    const organizationId = await this.getOrganizationId();
    const branchId = dto.branch_id || (await this.tenantContextService.getCurrentBranchId()) || '';

    // The client-supplied branch must belong to the authorized organization.
    await this.ensureBranchBelongsToOrg(organizationId, dto.branch_id);

    await this.ensureNoDuplicateContact(dto, organizationId);

    return this.dataSource.transaction(async (manager) => {
      const localId = await this.localIdService.nextLocalId(organizationId);
      const globalUuid = randomUUID();

      const memberRepo = manager.getRepository(Member);
      const member = memberRepo.create({
        ...dto,
        organization_id: organizationId,
        branch_id: branchId,
        global_uuid: globalUuid,
        local_id: localId,
        date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
        is_active: true,
      });

      const saved = await memberRepo.save(member);

      await this.outboxService.saveEventEnvelope(
        'MEMBER_CREATED',
        'v1',
        organizationId,
        { memberId: saved.id, localId: saved.local_id, organizationId },
        saved.global_uuid,
        undefined,
        manager, // transaction-scoped: MEMBER_CREATED commits/rolls back with the member row
      );

      return saved;
    });
  }

  /**
   * P3-04 — validate the tax-exemption patch against the member's stored state.
   *
   * The flag and its reason are coupled, and the coupling can only be judged with
   * the CURRENT row in hand: `{ tax_exempt: true }` alone must be rejected, but
   * `{ tax_exempt_reason: '...' }` alone is legal for a member who is ALREADY
   * exempt (the reason is being corrected). So this is enforced here rather than
   * with a conditional validator on the DTO, which cannot see stored state.
   *
   * Clearing the flag clears the reason too: a stale reason on a non-exempt member
   * would misreport why an invoice was untaxed.
   */
  private validateTaxExemption(
    dto: UpdateMemberDto,
    member: Member,
  ): { tax_exempt?: boolean; tax_exempt_reason?: string | null } {
    if (dto.tax_exempt === undefined && dto.tax_exempt_reason === undefined) {
      return {};
    }

    const resultingFlag = dto.tax_exempt ?? member.tax_exempt;
    const resultingReason = dto.tax_exempt_reason ?? member.tax_exempt_reason ?? null;

    if (resultingFlag && !resultingReason) {
      throw new BadRequestException(
        'tax_exempt_reason is required when a member is tax exempt',
      );
    }

    if (!resultingFlag) {
      return { tax_exempt: false, tax_exempt_reason: null };
    }

    return {
      tax_exempt: true,
      ...(dto.tax_exempt_reason !== undefined ? { tax_exempt_reason: resultingReason } : {}),
    };
  }

  async update(id: string, dto: UpdateMemberDto): Promise<Member> {
    const organizationId = await this.getOrganizationId();
    const member = await this.memberRepository.findOne({
      where: { id, organization_id: organizationId, is_active: true },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    await this.ensureNoDuplicateContact(dto, organizationId, id);

    const updates: Partial<Member> = {
      ...dto,
      ...this.validateTaxExemption(dto, member),
      date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : member.date_of_birth,
    };

    // Scope the update by the authorized org so the record cannot be moved
    // across tenants between the ownership check and the write.
    await this.memberRepository.update(
      { id, organization_id: organizationId },
      updates,
    );

    await this.outboxService.saveEventEnvelope(
      'MEMBER_UPDATED',
      'v1',
      organizationId,
      { memberId: id, organizationId },
      member.global_uuid,
    );

    return this.findOne(id);
  }

  async softDelete(id: string): Promise<void> {
    const organizationId = await this.getOrganizationId();
    const member = await this.memberRepository.findOne({
      where: { id, organization_id: organizationId, is_active: true },
    });
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const result = await this.memberRepository.update(
      { id, organization_id: organizationId, is_active: true },
      { is_active: false },
    );
    if (result.affected === 0) {
      throw new NotFoundException('Member not found');
    }

    await this.outboxService.saveEventEnvelope(
      'MEMBER_DEACTIVATED',
      'v1',
      organizationId,
      { memberId: id, organizationId },
      member.global_uuid,
    );
  }
}
