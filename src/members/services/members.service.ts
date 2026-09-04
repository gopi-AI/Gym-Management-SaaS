import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { Member } from '../entities/member.entity';
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly localIdService: LocalIdService,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  async getOrganizationId(): Promise<string> {
    const orgId = await this.tenantContextService.getCurrentOrganizationId();
    if (!orgId) {
      throw new NotFoundException('Organization context not found');
    }
    return orgId;
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

  async create(dto: CreateMemberDto): Promise<Member> {
    const organizationId = await this.getOrganizationId();
    const branchId = dto.branch_id || (await this.tenantContextService.getCurrentBranchId()) || '';

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

      await this.outboxService.saveEvent(
        'MEMBER_CREATED',
        JSON.stringify({ memberId: saved.id, localId: saved.local_id, organizationId }),
        saved.global_uuid,
      );

      return saved;
    });
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
      date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : member.date_of_birth,
    };

    await this.memberRepository.update(id, updates);

    await this.outboxService.saveEvent(
      'MEMBER_UPDATED',
      JSON.stringify({ memberId: id, organizationId }),
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

    await this.outboxService.saveEvent(
      'MEMBER_DEACTIVATED',
      JSON.stringify({ memberId: id, organizationId }),
      member.global_uuid,
    );
  }
}
