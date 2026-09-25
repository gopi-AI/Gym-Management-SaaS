import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { MembersService } from '../../members/services/members.service';
import { Lead } from '../entities/lead.entity'; import { LeadSource } from '../entities/lead-source.entity'; import { LeadStage } from '../entities/lead-stage.entity'; import { LeadActivity } from '../entities/lead-activity.entity';
import { Conversion } from '../entities/conversion.entity';
import { CreateMemberDto } from '../../members/dto/create-member.dto';
import { CreateActivityDto, CreateLeadDto, ListLeadsDto, UpdateLeadDto } from '../dto/lead.dto'; import { CRM_EVENT_TYPES, CRM_EVENT_VERSION, CRM_LEAD_STATUS } from '../crm.constants';
@Injectable()
export class CrmService {
  constructor(@InjectRepository(Lead) private readonly leads: Repository<Lead>, @InjectRepository(LeadSource) private readonly sources: Repository<LeadSource>, @InjectRepository(LeadStage) private readonly stages: Repository<LeadStage>, @InjectRepository(LeadActivity) private readonly activities: Repository<LeadActivity>, @InjectRepository(Conversion) private readonly conversions: Repository<Conversion>, private readonly tenant: TenantContextService, private readonly outbox: OutboxService, private readonly members: MembersService) {}
  private async org(): Promise<string> { const id = await this.tenant.getCurrentOrganizationId(); if (!id) throw new ForbiddenException('Organization context required'); return id; }
  private async branch(org: string, id: string) { await this.tenant.requireBranchAccess(org, id); }
  private async lead(id: string, org: string) { const lead = await this.leads.findOne({ where: { id, organization_id: org } }); if (!lead) throw new NotFoundException('Lead not found'); return lead; }
  async list(dto: ListLeadsDto) { const org = await this.org(); if (dto.branch_id) await this.branch(org, dto.branch_id); const [data,total] = await this.leads.findAndCount({ where: { organization_id: org, ...(dto.branch_id ? { branch_id: dto.branch_id } : {}), ...(dto.status ? { status: dto.status } : {}) }, order: { created_at: 'DESC' }, take: dto.limit, skip: (dto.page - 1) * dto.limit }); return { data, total, page: dto.page, limit: dto.limit }; }
  async findOne(id: string) { return this.lead(id, await this.org()); }
  async create(dto: CreateLeadDto) { const org = await this.org(); await this.branch(org, dto.branch_id); await this.validateRefs(org, dto.source_id, dto.stage_id); const lead = await this.leads.save(this.leads.create({ ...dto, organization_id: org, status: CRM_LEAD_STATUS.NEW })); await this.outbox.saveEventEnvelope(CRM_EVENT_TYPES.LEAD_CREATED, CRM_EVENT_VERSION, org, { leadId: lead.id, organizationId: org, branchId: lead.branch_id, sourceId: lead.source_id, status: lead.status }); return lead; }
  async update(id: string, dto: UpdateLeadDto) { const org = await this.org(); const lead = await this.lead(id, org); await this.validateRefs(org, dto.source_id, dto.stage_id); const previous = lead.status; Object.assign(lead, dto); const saved = await this.leads.save(lead); if (previous !== saved.status && saved.status === CRM_LEAD_STATUS.QUALIFIED) await this.outbox.saveEventEnvelope(CRM_EVENT_TYPES.LEAD_QUALIFIED, CRM_EVENT_VERSION, org, { leadId: saved.id, organizationId: org, stage: saved.status, qualifiedAt: new Date().toISOString() }); return saved; }
  async pipeline() { const org = await this.org(); return this.stages.find({ where: { organization_id: org }, order: { sort_order: 'ASC' } }); }
  async addActivity(id: string, dto: CreateActivityDto) { const org = await this.org(); await this.lead(id, org); const activity = await this.activities.save(this.activities.create({ ...dto, lead_id: id, organization_id: org, created_by: await this.tenant.getCurrentUserId() })); await this.outbox.saveEventEnvelope(CRM_EVENT_TYPES.LEAD_CONTACTED, CRM_EVENT_VERSION, org, { leadId: id, organizationId: org, activityId: activity.id, activityType: activity.activity_type, occurredAt: activity.occurred_at.toISOString() }); return activity; }
  async convert(id: string) {
    const organizationId = await this.org();
    const lead = await this.lead(id, organizationId);
    if (lead.status === CRM_LEAD_STATUS.CONVERTED || lead.member_id) {
      throw new ConflictException('Lead has already been converted');
    }

    const existingConversion = await this.conversions.findOne({ where: { organization_id: organizationId, lead_id: id } });
    if (existingConversion) {
      throw new ConflictException('Lead has already been converted');
    }

    const member = await this.members.create({
      first_name: lead.first_name,
      last_name: lead.last_name,
      phone: lead.phone || undefined,
      email: lead.email || undefined,
      branch_id: lead.branch_id,
    } as CreateMemberDto);

    const conversion = await this.conversions.save(this.conversions.create({
      organization_id: organizationId,
      lead_id: lead.id,
      member_id: member.id,
      membership_id: null,
    }));

    lead.member_id = member.id;
    lead.status = CRM_LEAD_STATUS.CONVERTED;
    const savedLead = await this.leads.save(lead);

    await this.outbox.saveEventEnvelope(
      CRM_EVENT_TYPES.MEMBER_CONVERTED,
      CRM_EVENT_VERSION,
      organizationId,
      { lead_id: savedLead.id, member_id: member.id, organization_id: organizationId },
      conversion.id,
    );

    return { lead: savedLead, member, conversion };
  }
  private async validateRefs(org: string, sourceId?: string, stageId?: string) { if (sourceId && !(await this.sources.findOne({ where: { id: sourceId, organization_id: org } }))) throw new ForbiddenException('Lead source is not in the authorized organization'); if (stageId && !(await this.stages.findOne({ where: { id: stageId, organization_id: org } }))) throw new ForbiddenException('Lead stage is not in the authorized organization'); }
}