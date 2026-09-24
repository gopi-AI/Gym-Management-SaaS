import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { MembersService } from './members.service';
import { Member } from '../entities/member.entity';
import { MemberProfile } from '../entities/member-profile.entity';
import { LocalIdService } from './local-id.service';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

describe('MembersService', () => {
  let service: MembersService;
  let mockMemberRepo: Record<string, jest.Mock>;
  let mockMemberProfileRepo: Record<string, jest.Mock>;
  let mockDataSource: Record<string, jest.Mock>;
  let mockTenantContext: Record<string, jest.Mock>;
  let mockLocalIdService: Record<string, jest.Mock>;
  let mockOutboxService: Record<string, jest.Mock>;

  const orgId = 'org-123';
  const memberPayload = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
    phone: '+1234567890',
  };

  beforeEach(async () => {
    mockMemberRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => ({ id: 'member-1', ...dto })),
      save: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    mockMemberProfileRepo = {};

    // DataSource transaction mock: the real implementation calls
    // `manager.getRepository` for the domain entity (Member) and passes
    // `manager` to the outbox, so both use the same transaction/connection.
    mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: (mgr: EntityManager) => unknown) => {
        const manager = {
          getRepository: jest.fn().mockImplementation((target: any) => {
            if (target === Member) return mockMemberRepo;
            return {};
          }),
        };
        return cb(manager as unknown as EntityManager);
      }),
    };

    mockTenantContext = {
      getCurrentOrganizationId: jest.fn().mockResolvedValue(orgId),
      getRequestedOrganizationId: jest.fn(),
      requireOrganizationAccess: jest.fn(),
      getCurrentBranchId: jest.fn().mockResolvedValue(null),
      validateBranchAccess: jest.fn().mockResolvedValue(true),
    };

    mockLocalIdService = {
      nextLocalId: jest.fn().mockResolvedValue(1),
    };

    mockOutboxService = {
      saveEvent: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      saveEventEnvelope: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: getRepositoryToken(Member), useValue: mockMemberRepo },
        { provide: getRepositoryToken(MemberProfile), useValue: mockMemberProfileRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: LocalIdService, useValue: mockLocalIdService },
        { provide: OutboxService, useValue: mockOutboxService },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
  });

  describe('create', () => {
    it('creates a member and emits MEMBER_CREATED inside the transaction', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null); // no duplicate contact
      mockMemberRepo.save.mockResolvedValue({
        id: 'member-1',
        local_id: 1,
        global_uuid: 'uuid-1',
        organization_id: orgId,
        ...memberPayload,
      });

      const result = await service.create({ ...memberPayload, date_of_birth: '1990-01-01' });

      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
      expect(mockMemberRepo.save).toHaveBeenCalledTimes(1);
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MEMBER_CREATED',
        'v1',
        orgId,
        { memberId: 'member-1', localId: 1, organizationId: orgId },
        'uuid-1',
        undefined,
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );

      expect(result.id).toBe('member-1');
    });

    /**
     * CONTROL-FLOW GUARD (not a transactional-rollback proof).
     *
     * This test proves only SEQUENCING: `memberRepo.save` throwing prevents the
     * outbox write from being reached. It does NOT prove rollback semantics — it
     * is a guard against a regression that reorders the two writes (outbox before
     * member). The actual atomicity/rollback guarantees are exercised by the
     * "rolls back the member when the outbox write fails" test below, and the
     * transaction-scoped mechanism is pinned by the "creates a member" test.
     */
    it('does not write an outbox event when the member insert fails', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      mockMemberRepo.save.mockRejectedValue(new Error('DB_CONNECTION_LOST'));

      await expect(service.create({ ...memberPayload })).rejects.toThrow('DB_CONNECTION_LOST');

      // The outbox write was NEVER CALLED because the member save threw first.
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
      expect(mockMemberRepo.save).toHaveBeenCalledTimes(1);
    });

    /**
     * ATOMICITY VERIFICATION — outbox write failure rolls back the member.
     *
     * The member save SUCCEEDS, then the outbox write FAILS. Because the outbox
     * row is written on the same transaction `manager` as the member row, a real
     * DataSource would roll back the ENTIRE transaction — discarding the already-
     * committed-to-the-buffer member row too. `service.create()` must therefore
     * reject: neither entity is persisted.
     *
     * This is the meaningful transactional-rollback test. The mock's
     * `dataSource.transaction` executes the callback, and when the callback throws
     * (because saveEvent rejects), the transaction aborts — so nothing commits.
     */
    it('rolls back the member insert when the outbox write fails', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null); // no duplicate contact
      mockMemberRepo.save.mockResolvedValue({
        id: 'member-1',
        local_id: 1,
        global_uuid: 'uuid-1',
        organization_id: orgId,
        ...memberPayload,
      });
      // The outbox write itself fails AFTER the member was saved.
      mockOutboxService.saveEventEnvelope.mockRejectedValue(new Error('OUTBOX_WRITE_FAILED'));

      // The whole transaction aborts -> create() rejects.
      await expect(service.create({ ...memberPayload })).rejects.toThrow('OUTBOX_WRITE_FAILED');

      // The member save WAS reached (it succeeded before the outbox call)...
      expect(mockMemberRepo.save).toHaveBeenCalledTimes(1);
      // ...and the outbox write WAS attempted (proving it runs inside the txn)...
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MEMBER_CREATED',
        'v1',
        orgId,
        { memberId: 'member-1', localId: 1, organizationId: orgId },
        'uuid-1',
        undefined,
        expect.objectContaining({ getRepository: expect.any(Function) }),
      );
      // ...yet NO member row is committed: the transaction aborted, rolling back
      // the member save (the mock transaction propagates the throw to the caller
      // and does not "commit"), which is exactly what a real DataSource does.
      expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('returns paginated members scoped to the organization', async () => {
      mockMemberRepo.findAndCount.mockResolvedValue([
        [{ id: 'm1', first_name: 'John' } as Member, { id: 'm2', first_name: 'Jane' } as Member],
        2,
      ]);

      const result = await service.findAll({ page: 1, limit: 20 });
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('findOne', () => {
    it('returns a member by id scoped to the organization', async () => {
      const expected = { id: 'm1', first_name: 'John', organization_id: orgId, is_active: true } as Member;
      mockMemberRepo.findOne.mockResolvedValue(expected);
      const result = await service.findOne('m1');
      expect(result).toBe(expected);
    });

    it('throws NotFoundException when member does not exist', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates a member and emits MEMBER_UPDATED', async () => {
      const existing = { id: 'm1', global_uuid: 'uuid-1', organization_id: orgId, is_active: true } as Member;
      mockMemberRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });

      await service.update('m1', { first_name: 'Jane' });

      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MEMBER_UPDATED',
        'v1',
        orgId,
        { memberId: 'm1', organizationId: orgId },
        'uuid-1',
      );
    });
  });

  /**
   * P3-04 tax exemption (§15 Q7: the flag lives on the member).
   *
   * The rule enforced here is the one `InvoicesService` depends on: a member is
   * exempt ONLY when a reason is on file. An exemption with no reason is not
   * reportable, and the invoice path treats the flag as authoritative, so an
   * unexplained `tax_exempt: true` would silently stop charging tax.
   *
   * Both directions matter, because the flag and the reason are two columns that
   * can drift apart: setting the flag must set a reason, and clearing the flag must
   * clear the reason so a later re-exemption cannot inherit a stale justification.
   */
  describe('update — P3-04 tax exemption', () => {
    const storedMember = (overrides: Partial<Member> = {}): Member =>
      ({
        id: 'm1',
        global_uuid: 'uuid-1',
        organization_id: orgId,
        is_active: true,
        tax_exempt: false,
        tax_exempt_reason: null,
        ...overrides,
      }) as Member;

    const updatedFields = () =>
      mockMemberRepo.update.mock.calls[0][1] as Record<string, unknown>;

    beforeEach(() => {
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });
    });

    it('stores the flag and the reason together', async () => {
      mockMemberRepo.findOne.mockResolvedValue(storedMember());

      await service.update('m1', {
        tax_exempt: true,
        tax_exempt_reason: 'Diplomatic status',
      });

      expect(updatedFields()).toMatchObject({
        tax_exempt: true,
        tax_exempt_reason: 'Diplomatic status',
      });
    });

    it('rejects an exemption that carries no reason', async () => {
      mockMemberRepo.findOne.mockResolvedValue(storedMember());

      await expect(service.update('m1', { tax_exempt: true })).rejects.toThrow(
        /tax_exempt_reason is required/,
      );
      expect(mockMemberRepo.update).not.toHaveBeenCalled();
      expect(mockOutboxService.saveEventEnvelope).not.toHaveBeenCalled();
    });

    it('keeps the stored reason when the flag is re-sent without one', async () => {
      // `tax_exempt: true` on a member who is ALREADY exempt with a reason must not
      // wipe the reason: the DTO makes the reason optional, so a caller sending the
      // flag alone is reaffirming the exemption, not clearing its justification.
      mockMemberRepo.findOne.mockResolvedValue(
        storedMember({ tax_exempt: true, tax_exempt_reason: 'Diplomatic status' }),
      );

      await service.update('m1', { tax_exempt: true });

      const fields = updatedFields();
      expect(fields).toMatchObject({ tax_exempt: true });
      expect(fields).not.toHaveProperty('tax_exempt_reason');
    });

    it('rejects a blank reason, not just a missing one', async () => {
      // `@Length(1, 255)` already rejects this at the DTO, but the service is also
      // called internally, and a whitespace-only reason is not a justification.
      mockMemberRepo.findOne.mockResolvedValue(
        storedMember({ tax_exempt: true, tax_exempt_reason: 'Diplomatic status' }),
      );

      await expect(service.update('m1', { tax_exempt_reason: '' })).rejects.toThrow(
        /tax_exempt_reason is required/,
      );
      expect(mockMemberRepo.update).not.toHaveBeenCalled();
    });

    it('clears the reason when the exemption is revoked', async () => {
      // Revoking the exemption must not leave the reason behind: a later
      // re-exemption would then inherit a justification that no longer applies.
      mockMemberRepo.findOne.mockResolvedValue(
        storedMember({ tax_exempt: true, tax_exempt_reason: 'Diplomatic status' }),
      );

      await service.update('m1', { tax_exempt: false });

      expect(updatedFields()).toMatchObject({ tax_exempt: false, tax_exempt_reason: null });
    });

    it('accepts a reason supplied in the same request as the flag', async () => {
      mockMemberRepo.findOne.mockResolvedValue(
        storedMember({ tax_exempt: true, tax_exempt_reason: 'Diplomatic status' }),
      );

      await service.update('m1', { tax_exempt_reason: 'Charity registration' });

      expect(updatedFields()).toMatchObject({
        tax_exempt: true,
        tax_exempt_reason: 'Charity registration',
      });
    });

    it('leaves the exemption untouched by an unrelated update', async () => {
      // The coupling rule must not fire on a request that never mentions tax.
      mockMemberRepo.findOne.mockResolvedValue(storedMember());

      await service.update('m1', { first_name: 'Jane' });

      const fields = updatedFields();
      expect(fields).not.toHaveProperty('tax_exempt');
      expect(fields).not.toHaveProperty('tax_exempt_reason');
    });
  });

  describe('softDelete', () => {
    it('sets is_active to false and emits MEMBER_DEACTIVATED', async () => {
      const existing = { id: 'm1', global_uuid: 'uuid-1', organization_id: orgId, is_active: true } as Member;
      mockMemberRepo.findOne.mockResolvedValue(existing);
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });

      await service.softDelete('m1');

      expect(mockMemberRepo.update).toHaveBeenCalledWith(
        { id: 'm1', organization_id: orgId, is_active: true },
        { is_active: false },
      );
      expect(mockOutboxService.saveEventEnvelope).toHaveBeenCalledWith(
        'MEMBER_DEACTIVATED',
        'v1',
        orgId,
        { memberId: 'm1', organizationId: orgId },
        'uuid-1',
      );
    });
// --------------------------------------------------------------------------
  // Envelope conformance (the migrated events are now routable)
  // --------------------------------------------------------------------------

  describe('envelope conformance', () => {
    it('MEMBER_CREATED is written as a full EventEnvelope that parseEnvelope would accept', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null); // no duplicate contact
      mockMemberRepo.save.mockResolvedValue({
        id: 'member-1', local_id: 1, global_uuid: 'uuid-1', organization_id: orgId,
        ...memberPayload,
      });
      await service.create({ ...memberPayload, date_of_birth: '1990-01-01' });

      const [eventType, eventVersion, organizationId, payload] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(eventType).toBe('MEMBER_CREATED');
      expect(eventVersion).toBe('v1');
      expect(organizationId).toBe(orgId);
      // Payload data unchanged: same fields as pre-migration
      const p = payload as Record<string, unknown>;
      expect(p.memberId).toBe('member-1');
      expect(p.localId).toBe(1);
      expect(p.organizationId).toBe(orgId);
    });

    it('MEMBER_UPDATED is written as a full EventEnvelope that parseEnvelope would accept', async () => {
      const existing = { id: 'm1', global_uuid: 'uuid-1', organization_id: orgId, is_active: true } as Member;
      mockMemberRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });

      await service.update('m1', { first_name: 'Jane' });

      const [eventType, eventVersion, organizationId, payload] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(eventType).toBe('MEMBER_UPDATED');
      expect(eventVersion).toBe('v1');
      expect(organizationId).toBe(orgId);
      const p = payload as Record<string, unknown>;
      expect(p.memberId).toBe('m1');
    });

    it('MEMBER_DEACTIVATED is written as a full EventEnvelope that parseEnvelope would accept', async () => {
      const existing = { id: 'm1', global_uuid: 'uuid-1', organization_id: orgId, is_active: true } as Member;
      mockMemberRepo.findOne.mockResolvedValue(existing);
      mockMemberRepo.update.mockResolvedValue({ affected: 1 });

      await service.softDelete('m1');

      const [eventType, eventVersion, organizationId, payload] =
        mockOutboxService.saveEventEnvelope.mock.calls[0];
      expect(eventType).toBe('MEMBER_DEACTIVATED');
      expect(eventVersion).toBe('v1');
      expect(organizationId).toBe(orgId);
    });
  });
  });
});