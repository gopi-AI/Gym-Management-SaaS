import { CreateMembershipDto } from './create-membership.dto';

describe('CreateMembershipDto', () => {
  it('should be defined', () => {
    const dto = new CreateMembershipDto();
    expect(dto).toBeDefined();
  });

  it('should have required fields', () => {
    const dto = new CreateMembershipDto();
    dto.member_id = 'member-1';
    dto.plan_id = 'plan-1';
    expect(dto.member_id).toBe('member-1');
    expect(dto.plan_id).toBe('plan-1');
  });

  it('should allow optional fields', () => {
    const dto = new CreateMembershipDto();
    dto.member_id = 'member-1';
    dto.plan_id = 'plan-1';
    dto.start_date = '2026-09-12';
    dto.branch_id = 'branch-1';
    expect(dto.start_date).toBe('2026-09-12');
    expect(dto.branch_id).toBe('branch-1');
  });
});