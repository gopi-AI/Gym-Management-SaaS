import { ConflictException } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CRM_EVENT_TYPES } from '../crm.constants';
describe('CrmService', () => {
  const repo = () => ({ findOne: jest.fn(), findAndCount: jest.fn(), find: jest.fn(), create: jest.fn((x) => x), save: jest.fn((x) => Promise.resolve({ id: 'lead-1', ...x })) });
  const setup = () => {
    const leads = repo(); const sources = repo(); const stages = repo(); const activities = repo(); const conversions = repo();
    const tenant = { getCurrentOrganizationId: jest.fn().mockResolvedValue('org-1'), requireBranchAccess: jest.fn(), getCurrentUserId: jest.fn().mockResolvedValue('user-1') };
    const outbox = { saveEventEnvelope: jest.fn() };
    const members = { create: jest.fn() };
    const service = new CrmService(leads as any, sources as any, stages as any, activities as any, conversions as any, tenant as any, outbox as any, members as any);
    return { service, leads, sources, stages, activities, conversions, tenant, outbox, members };
  };
  it('creates a branch-scoped lead and emits LeadCreated', async () => { const x=setup(); x.leads.save.mockResolvedValue({ id:'lead-1', branch_id:'branch-1', status:'new' }); const result=await x.service.create({ branch_id:'branch-1', first_name:'A', last_name:'B' } as any); expect(result.id).toBe('lead-1'); expect(x.tenant.requireBranchAccess).toHaveBeenCalledWith('org-1','branch-1'); expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(CRM_EVENT_TYPES.LEAD_CREATED,'v1','org-1',expect.objectContaining({leadId:'lead-1'})); });
  it('updates status and emits qualification only for an authorized lead', async () => { const x=setup(); x.leads.findOne.mockResolvedValue({ id:'lead-1', organization_id:'org-1', status:'contacted' }); x.leads.save.mockResolvedValue({ id:'lead-1', organization_id:'org-1', status:'qualified' }); await x.service.update('lead-1',{status:'qualified'} as any); expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith('LeadQualified','v1','org-1',expect.anything()); });
  it('does not expose another organization lead', async () => { const x=setup(); x.leads.findOne.mockResolvedValue(null); await expect(x.service.findOne('other')).rejects.toThrow('Lead not found'); expect(x.leads.findOne).toHaveBeenCalledWith({where:{id:'other',organization_id:'org-1'}}); });
  it('lists the organization pipeline in stage order', async () => { const x=setup(); x.stages.find.mockResolvedValue([{key:'new'},{key:'qualified'}]); await expect(x.service.pipeline()).resolves.toEqual([{key:'new'},{key:'qualified'}]); expect(x.stages.find).toHaveBeenCalledWith({where:{organization_id:'org-1'},order:{sort_order:'ASC'}}); });
  it('converts an authorized lead into a member and emits MemberConverted', async () => {
    const x = setup();
    const lead = { id: 'lead-1', organization_id: 'org-1', branch_id: 'branch-1', first_name: 'A', last_name: 'B', phone: '123', email: 'a@example.com', status: 'qualified' };
    const member = { id: 'member-1', organization_id: 'org-1', branch_id: 'branch-1' };
    x.leads.findOne.mockResolvedValue(lead);
    x.members.create.mockResolvedValue(member);
    x.conversions.save.mockResolvedValue({ id: 'conversion-1', organization_id: 'org-1', lead_id: 'lead-1', member_id: 'member-1', membership_id: null });
    x.leads.save.mockResolvedValue({ ...lead, member_id: 'member-1', status: 'converted' });

    const result = await x.service.convert('lead-1');

    expect(x.members.create).toHaveBeenCalledWith(expect.objectContaining({
      first_name: 'A', last_name: 'B', phone: '123', email: 'a@example.com', branch_id: 'branch-1',
    }));
    expect(x.conversions.create).toHaveBeenCalledWith({ organization_id: 'org-1', lead_id: 'lead-1', member_id: 'member-1', membership_id: null });
    expect(x.leads.save).toHaveBeenCalledWith(expect.objectContaining({ member_id: 'member-1', status: 'converted' }));
    expect(x.outbox.saveEventEnvelope).toHaveBeenCalledWith(CRM_EVENT_TYPES.MEMBER_CONVERTED, 'v1', 'org-1', { lead_id: 'lead-1', member_id: 'member-1', organization_id: 'org-1' }, 'conversion-1');
    expect(result.conversion.member_id).toBe('member-1');
  });

  it('rejects a lead that has already been converted', async () => {
    const x = setup();
    x.leads.findOne.mockResolvedValue({ id: 'lead-1', organization_id: 'org-1', status: 'converted', member_id: 'member-1' });
    await expect(x.service.convert('lead-1')).rejects.toBeInstanceOf(ConflictException);
    expect(x.members.create).not.toHaveBeenCalled();
  });

  it('rejects a lead from another organization', async () => {
    const x = setup();
    x.leads.findOne.mockResolvedValue(null);
    await expect(x.service.convert('other-lead')).rejects.toThrow('Lead not found');
    expect(x.leads.findOne).toHaveBeenCalledWith({ where: { id: 'other-lead', organization_id: 'org-1' } });
    expect(x.members.create).not.toHaveBeenCalled();
  });
});