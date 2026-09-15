import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { MemberDocument } from '../entities/member-document.entity';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';
import { S3Service } from '../../shared/storage/s3.service';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(MemberDocument)
    private readonly documentRepository: Repository<MemberDocument>,
    private readonly tenantContextService: TenantContextService,
    private readonly s3Service: S3Service,
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
   * Single legal write path for document uploads.
   *
   * Atomicity strategy (S3/DB):
   *   1. Upload file to S3 FIRST (builds the key from Q25 convention).
   *   2. Insert DB row SECOND.
   *   3. If DB insert fails → best-effort S3 cleanup (delete the object),
   *      then re-throw the DB error.
   *
   * This means the only failure mode is an orphan S3 object (no DB row),
   * never a DB row pointing to a nonexistent S3 object.
   */
  async upload(
    memberId: string,
    dto: UploadDocumentDto,
    fileBuffer: Buffer,
  ): Promise<MemberDocument> {
    const organizationId = await this.getOrganizationId();
    const fileUuid = randomUUID();
    const s3Key = this.s3Service.buildKey(
      organizationId,
      memberId,
      fileUuid,
      dto.file_name,
    );

    // Step 1: Upload to S3 first
    await this.s3Service.upload(s3Key, fileBuffer, dto.mime_type ?? 'application/octet-stream');

    let document: MemberDocument;
    try {
      // Step 2: Insert DB row
      document = this.documentRepository.create({
        organization_id: organizationId,
        member_id: memberId,
        document_type: dto.document_type,
        file_name: dto.file_name,
        s3_key: s3Key,
        mime_type: dto.mime_type ?? null,
        file_size_bytes: dto.file_size_bytes ?? null,
        uploaded_by: (await this.tenantContextService.getCurrentUserId()) ?? organizationId,
        is_active: true,
      });
    } catch (createError) {
      await this.s3Service.delete(s3Key);
      throw createError;
    }

    try {
      return await this.documentRepository.save(document);
    } catch (saveError) {
      // Best-effort S3 cleanup: if this fails, log and move on — never mask the original error
      try {
        await this.s3Service.delete(s3Key);
      } catch {
        // Log would go here in production; S3 orphan will be picked up by cleanup job
      }
      throw saveError;
    }
  }

  /**
   * List all active documents for a member.
   */
  async findAll(memberId: string): Promise<MemberDocument[]> {
    const organizationId = await this.getOrganizationId();
    return this.documentRepository.find({
      where: {
        organization_id: organizationId,
        member_id: memberId,
        is_active: true,
      },
      order: { uploaded_at: 'DESC' },
    });
  }

  /**
   * Find a single document by id, scoped to member and org.
   */
  async findOne(memberId: string, documentId: string): Promise<MemberDocument> {
    const organizationId = await this.getOrganizationId();
    const document = await this.documentRepository.findOne({
      where: {
        id: documentId,
        organization_id: organizationId,
        member_id: memberId,
        is_active: true,
      },
    });
    if (!document) {
      throw new NotFoundException('Document not found');
    }
    return document;
  }

  /**
   * Soft-delete a document (sets is_active = false).
   * Does NOT delete the S3 object — the orphan is managed by a future cleanup job.
   */
  async softDelete(memberId: string, documentId: string): Promise<void> {
    const organizationId = await this.getOrganizationId();
    const result = await this.documentRepository.update(
      {
        id: documentId,
        organization_id: organizationId,
        member_id: memberId,
        is_active: true,
      },
      { is_active: false },
    );
    if (result.affected === 0) {
      throw new NotFoundException('Document not found');
    }
  }
}