import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { MemberConsent } from '../entities/consent-log.entity';
import { ConsentType, CONSENT_TYPE_VALUES } from '../entities/consent-type.enum';
import { GrantConsentDto } from '../dto/grant-consent.dto';
import { RevokeConsentDto } from '../dto/revoke-consent.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { OutboxService } from '../../shared/outbox/outbox.service';

@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(MemberConsent)
    private readonly consentRepository: Repository<MemberConsent>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tenantContextService: TenantContextService,
    private readonly outboxService: OutboxService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) {
      return currentOrgId;
    }
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) {
      throw new NotFoundException('Organization context not found');
    }
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /**
   * Single legal write path for consent grants.
   *
   * Appends a new row with is_given = true. NEVER updates an existing row.
   * The consent event is written to the outbox inside the same transaction.
   */
  async grant(
    memberId: string,
    dto: GrantConsentDto,
  ): Promise<MemberConsent> {
    const organizationId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MemberConsent);

      const consent = repo.create({
        organization_id: organizationId,
        member_id: memberId,
        consent_type: dto.consent_type,
        is_given: dto.is_given,
        given_at: new Date(dto.given_at),
        expires_at: dto.expires_at ? new Date(dto.expires_at) : null,
        document_id: dto.document_id ?? null,
        version: dto.version ?? null,
      });

      const saved = await repo.save(consent);

      // Emit consent event inside the same transaction (GDPR audit trail)
      await this.outboxService.saveEventEnvelope(
        'MemberConsentGiven.v1',
        'v1',
        organizationId,
        {
          consentId: saved.id,
          memberId,
          consentType: dto.consent_type,
          givenAt: dto.given_at,
          expiresAt: dto.expires_at ?? null,
        },
        memberId,
        undefined,
        manager,
      );

      return saved;
    });
  }

  /**
   * Single legal write path for consent revocation.
   *
   * Appends a new row with is_given = false, revoked_at, revocation_reason.
   * NEVER updates an existing row.
   * The revocation event is written to the outbox inside the same transaction.
   */
  async revoke(
    memberId: string,
    dto: RevokeConsentDto,
  ): Promise<MemberConsent> {
    const organizationId = await this.getOrganizationId();

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(MemberConsent);

      // Pre-check: verify there's an active grant to revoke
      const currentStatus = await this.getCurrentStatusInternal(
        manager,
        organizationId,
        memberId,
        dto.consent_type,
      );
      if (!currentStatus || !currentStatus.is_given) {
        throw new NotFoundException(
          `No active grant found for consent type "${dto.consent_type}" on this member`,
        );
      }

      const consent = repo.create({
        organization_id: organizationId,
        member_id: memberId,
        consent_type: dto.consent_type,
        is_given: false,
        given_at: currentStatus.given_at,
        revoked_at: new Date(dto.revoked_at),
        revocation_reason: dto.revocation_reason ?? null,
      });

      const saved = await repo.save(consent);

      // Emit revocation event inside the same transaction
      await this.outboxService.saveEventEnvelope(
        'MemberConsentRevoked.v1',
        'v1',
        organizationId,
        {
          consentId: saved.id,
          memberId,
          consentType: dto.consent_type,
          revokedAt: dto.revoked_at,
          reason: dto.revocation_reason ?? null,
        },
        memberId,
        undefined,
        manager,
      );

      return saved;
    });
  }

  /**
   * Get the current status for a (member, consent_type) pair.
   * Returns the latest row by created_at, or null if no consent record exists.
   */
  async getCurrentStatus(
    memberId: string,
    consentType: ConsentType,
  ): Promise<MemberConsent | null> {
    const organizationId = await this.getOrganizationId();
    return this.consentRepository.findOne({
      where: {
        organization_id: organizationId,
        member_id: memberId,
        consent_type: consentType,
      },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Get current status for all consent types for a member.
   */
  async getAllCurrentStatuses(
    memberId: string,
  ): Promise<Record<string, MemberConsent | null>> {
    const organizationId = await this.getOrganizationId();
    const result: Record<string, MemberConsent | null> = {};

    for (const type of CONSENT_TYPE_VALUES) {
      result[type] = await this.consentRepository.findOne({
        where: {
          organization_id: organizationId,
          member_id: memberId,
          consent_type: type,
        },
        order: { created_at: 'DESC' },
      });
    }

    return result;
  }

  /**
   * List all consent rows for a member (full ledger history).
   */
  async findAll(memberId: string): Promise<MemberConsent[]> {
    const organizationId = await this.getOrganizationId();
    return this.consentRepository.find({
      where: {
        organization_id: organizationId,
        member_id: memberId,
      },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Internal helper to query current status inside a running transaction.
   */
  private async getCurrentStatusInternal(
    manager: any,
    organizationId: string,
    memberId: string,
    consentType: ConsentType,
  ): Promise<MemberConsent | null> {
    const repo = manager.getRepository(MemberConsent);
    return repo.findOne({
      where: {
        organization_id: organizationId,
        member_id: memberId,
        consent_type: consentType,
      },
      order: { created_at: 'DESC' },
    });
  }
}

